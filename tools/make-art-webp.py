# -*- coding: utf-8 -*-
"""
配图压缩  ——  原图 → 网页用的 WebP（大图 + 缩略图两档）
==========================================================
为什么分两档：
  瀑布流里一张卡片的封面只有 230px 宽左右，却去加载 900px 的大图，
  11 张就是 1MB 起步，手机上白等。所以
    · <slug>.webp        长边 900，点开弹窗时才加载
    · <slug>-thumb.webp  长边 460，列表封面用

水墨画大片留白，WebP 压得极好，一般能压到原图的 1/5 以下。

用法：
    python tools/make-art-webp.py
前置：先跑 node tools/fetch-art.js 把原图下到 _build/art/
"""
import json
import os
import pathlib
import sys

from PIL import Image

ROOT  = pathlib.Path(__file__).resolve().parent.parent
SRC   = ROOT / '_build' / 'art'
# 输出目录可用环境变量覆盖，方便先出到预览目录、不覆盖现有配图
DEST  = pathlib.Path(os.environ.get('ART_DEST') or (ROOT / 'images' / 'art'))

FULL_EDGE  = 900
THUMB_EDGE = 460
QUALITY    = 82


def fit(im, edge):
    """按长边等比缩放，不放大"""
    w, h = im.size
    if max(w, h) <= edge:
        return im
    k = edge / max(w, h)
    return im.resize((round(w * k), round(h * k)), Image.LANCZOS)


def main():
    manifest = SRC / 'manifest.json'
    if not manifest.exists():
        sys.exit('没找到 _build/art/manifest.json，先跑 node tools/fetch-art.js')

    data = json.loads(manifest.read_text(encoding='utf-8'))
    DEST.mkdir(parents=True, exist_ok=True)

    out, total_full, total_thumb = {}, 0, 0
    for slug, m in data.items():
        src = SRC / m['file']
        if not src.exists():
            print(f'✗ {slug}: 缺少 {m["file"]}')
            continue

        im = Image.open(src).convert('RGB')       # WebP 不需要 alpha，丢掉更小
        full  = fit(im, FULL_EDGE)
        thumb = fit(im, THUMB_EDGE)

        f = DEST / f'{slug}.webp'
        t = DEST / f'{slug}-thumb.webp'
        full.save(f, 'WEBP', quality=QUALITY, method=6)
        thumb.save(t, 'WEBP', quality=QUALITY, method=6)

        total_full  += f.stat().st_size
        total_thumb += t.stat().st_size

        out[slug] = {
            'src':   f'images/art/{slug}.webp',
            'thumb': f'images/art/{slug}-thumb.webp',
            'title': m.get('title', ''),
            'date':  m.get('date', ''),
            # 认 manifest 里写的出处：AI 生成的必须标「AI 生成」（合规要求），
            # 没写的按公版古画处理
            'credit': m.get('credit') or '克利夫兰艺术博物馆 CC0',
            'ai':    bool(m.get('ai')),
            'page':  m.get('page', ''),
            'w': full.width, 'h': full.height,
        }
        print(f'✓ {slug:<11} 大图 {full.width}x{full.height} {f.stat().st_size/1024:5.1f} KB'
              f'   缩略图 {thumb.width}x{thumb.height} {t.stat().st_size/1024:5.1f} KB')

    (DEST / 'manifest.json').write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'\n共 {len(out)} 幅')
    print(f'  大图合计   {total_full/1024:7.0f} KB（只在点开时加载）')
    print(f'  缩略图合计 {total_thumb/1024:7.0f} KB（列表首屏加载）')


if __name__ == '__main__':
    main()
