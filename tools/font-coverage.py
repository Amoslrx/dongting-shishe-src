# -*- coding: utf-8 -*-
"""
字体覆盖率检查  ——  换字体前先确认「不缺字」
=============================================
从 index.html 里抽出所有会渲染的汉字，逐个核对候选字体的 cmap。
缺字的后果：那个字不会用书法体渲染，浏览器退回宋体 —— 整篇「混排」很难看。

用法：
    python tools/font-coverage.py 字体1.ttf 字体2.ttf ...
"""
import pathlib
import re
import sys

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXTRA = '，。、；：？！「」『』（）《》〈〉—…·　0123456789'


def charset():
    text = (ROOT / 'index.html').read_text(encoding='utf-8')
    clean = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    clean = re.sub(r'/\*.*?\*/', '', clean, flags=re.S)
    clean = re.sub(r'(?m)^[ \t]*//.*$', '', clean)
    chars = set(re.findall(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]', clean))
    return chars | set(EXTRA)


def main():
    want = charset()
    print(f'index.html 需要 {len(want)} 个字符\n')
    for f in sys.argv[1:]:
        p = pathlib.Path(f)
        if not p.exists():
            print(f'{p.name}: 文件不存在')
            continue
        font = TTFont(f)
        cmap = font.getBestCmap()
        missing = [c for c in sorted(want) if ord(c) not in cmap]
        tag = '✓ 全覆盖' if not missing else f'✗ 缺 {len(missing)} 字'
        print(f'{p.name:<34} 字形 {font["maxp"].numGlyphs:>5}  {tag}')
        if missing:
            print(f'{"":34} 缺字示例：{"".join(missing[:40])}')


if __name__ == '__main__':
    main()
