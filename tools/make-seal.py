# -*- coding: utf-8 -*-
"""
社徽抠图工具  ——  把带白底的 logo 图片做成透明底印章 PNG
==========================================================
做法不是「删掉白色像素」那么简单：

  1. 按亮度算 alpha：越黑越不透明，深色区拉满，边缘线性过渡 → 平滑抗锯齿
  2. 白底和白色镂空字一起变透明 → 字会透出宣纸底色，
     看起来像真盖上去的印，而不是贴了一张白底图片
  3. 全透明处把 RGB 清零 → JPEG 残留噪点会让 PNG 完全压不动
  4. 单色墨迹自动压成纯黑（形状完全由 alpha 承载）→ 体积再省 3 倍以上
     若检测到是彩色图，则保留原色
  5. 用 alpha 通道求包围盒裁掉四周空白，尺寸才可预期

用法：
    python tools/make-seal.py [图片路径]
    默认读 东亭诗社图片.jpeg，输出 ink-seal.png + ink-seal.base64.txt
"""
import base64
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT  = ROOT / 'ink-seal.png'
B64  = ROOT / 'ink-seal.base64.txt'

SIZE = 192          # 输出边长（显示约 64px，192 够 3 倍屏）
LO, HI = 190, 235   # 亮度 <=LO 全不透明；>=HI 全透明；中间线性过渡
MONO_SPREAD = 30    # 非白像素的通道极差均值低于此值，视为单色墨迹


def main():
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / '东亭诗社图片.jpeg')
    if not src.exists():
        sys.exit(f'找不到图片：{src}')

    im = Image.open(src).convert('RGBA')
    w, h = im.size
    px = im.load()

    # ---- 先判断是不是单色墨迹 ----
    spread, n = 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            if r + g + b < 700:                    # 只看非白像素
                spread += max(r, g, b) - min(r, g, b)
                n += 1
    mono = (spread / n if n else 0) < MONO_SPREAD
    print(f'墨色判断：平均通道极差 {(spread/n if n else 0):.1f} → '
          f'{"单色，压成纯黑（体积更小）" if mono else "彩色，保留原色"}')

    # ---- 按亮度算 alpha ----
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            lum = (r * 299 + g * 587 + b * 114) // 1000
            if lum >= HI:
                a = 0
            elif lum <= LO:
                a = 255
            else:
                a = int((HI - lum) / (HI - LO) * 255)

            if a == 0:
                px[x, y] = (0, 0, 0, 0)            # 透明处清零 RGB，去掉 JPEG 噪点
            elif mono:
                px[x, y] = (0, 0, 0, a)            # 纯黑 + alpha：形状全靠 alpha 表达
            else:
                px[x, y] = (r, g, b, a)

    # ---- 用 alpha 通道求包围盒（不能用 getbbox()，它会把白底也算进去）----
    box = im.getchannel('A').getbbox()
    if not box:
        sys.exit('整张图都是透明的，检查一下输入图片')
    im = im.crop(box)

    # ---- 居中放进正方形画布，方便 CSS 当正方形摆放 ----
    side = max(im.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)

    canvas.save(OUT, optimize=True)
    B64.write_text(base64.b64encode(OUT.read_bytes()).decode('ascii'), encoding='ascii')
    print(f'原图 {w}x{h} → 裁到 {box[2]-box[0]}x{box[3]-box[1]} → 输出 {SIZE}x{SIZE}')
    print(f'已生成 {OUT.name}：{OUT.stat().st_size/1024:.1f} KB'
          f'（内联进 HTML 约 +{B64.stat().st_size/1024:.1f} KB）')


if __name__ == '__main__':
    main()
