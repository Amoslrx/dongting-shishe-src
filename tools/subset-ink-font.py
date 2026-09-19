# -*- coding: utf-8 -*-
"""
书法字体子集化工具  ——  给「竖排阅读」用的毛笔字体瘦身
========================================================
把 Ma Shan Zheng（马善政毛笔楷书，OFL 1.1 授权，可自由嵌入网页）
裁剪成只包含 index.html 里实际出现的汉字，体积从 5.6 MB 降到几百 KB。

用法：
    python tools/subset-ink-font.py 路径/到/MaShanZheng-Regular.ttf

    字体下载（OFL 1.1，可自由嵌入与再分发）：
    https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/mashanzheng/MaShanZheng-Regular.ttf
    依赖：pip install fonttools brotli

⚠️⚠️ 换了新诗之后必须重跑一次这个脚本！
    字体是「按当前作品里出现过的字」裁剪的。新诗若用到没收录的汉字，
    那个字不会被渲染成毛笔体，浏览器会退回宋体 —— 整篇看起来会「混排」。
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / 'index.html'
OUT  = ROOT / 'ink-brush.woff2'          # 生成的字体文件
B64  = ROOT / 'ink-brush.base64.txt'     # base64 文本，用于内联进 HTML

# 保险字符：中文标点、数字、常见诗词虚字
EXTRA = '，。、；：？！「」『』（）《》〈〉—…·　0123456789'


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'MaShanZheng-Regular.ttf'
    if not pathlib.Path(src).exists():
        sys.exit(f'找不到字体文件：{src}')

    text = HTML.read_text(encoding='utf-8')
    # 先剥掉 HTML / CSS / JS 注释：注释里的汉字永远不会渲染，
    # 不剥的话会被一起编进字体，白白增大体积
    clean = re.sub(r'<!--.*?-->', '', text, flags=re.S)     # HTML 注释
    clean = re.sub(r'/\*.*?\*/', '', clean, flags=re.S)     # CSS / JS 块注释
    clean = re.sub(r'(?m)^[ \t]*//.*$', '', clean)          # JS 行注释

    # 抓出真正会渲染的汉字（含扩展区）与标点
    chars = set(re.findall(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]', clean))
    chars |= set(EXTRA)
    subset_text = ''.join(sorted(chars))
    print(f'index.html 中扫到 {len(chars)} 个独立字符，全部编入子集')

    from fontTools.ttLib import TTFont
    from fontTools.subset import Options, Subsetter

    opts = Options()
    opts.hinting = False            # 去掉 hinting，网页渲染不需要
    opts.desubroutinize = True      # 展平 CFF 子程序，woff2 压得更狠
    opts.notdef_outline = True
    opts.drop_tables += ['DSIG']

    font = TTFont(src)
    ss = Subsetter(options=opts)
    ss.populate(text=subset_text)
    ss.subset(font)
    font.flavor = 'woff2'           # 需要 brotli
    font.save(str(OUT))

    before = pathlib.Path(src).stat().st_size
    after  = OUT.stat().st_size
    print(f'原字体 {before/1024/1024:.2f} MB  →  {OUT.name} {after/1024:.1f} KB'
          f'  （压到 {after/before*100:.1f}%）')

    B64.write_text(base64.b64encode(OUT.read_bytes()).decode('ascii'), encoding='ascii')
    print(f'base64 文本已写出：{B64.name}（{B64.stat().st_size/1024:.1f} KB），'
          f'内联进 index.html 后大概增加 {B64.stat().st_size/1024:.0f} KB')


if __name__ == '__main__':
    main()
