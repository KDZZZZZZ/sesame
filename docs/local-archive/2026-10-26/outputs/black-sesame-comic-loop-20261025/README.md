# 黑芝麻六格手绘循环

最新版位于 `rendered-stable-base/`。按第一帧对齐每一帧芝麻堆的左右边界和底边，修复整体上移与放大；保留顶部形变、低帧率和手绘特效。4K 成品实测堆体宽度与底边的帧间差均为 1 像素（重采样边缘）。几何参数见 `source/alignment.json`，检验记录见 `rendered-stable-base/verification.json`。

按原图的连环画方式修正：保留原有分镜、粗糙墨线、水彩笔触、长速度线、弹跳弧线、强调线及芝麻堆抖动。将芝麻改为黑色，缩小下落粒，最后落下的小粒藏在普通芝麻后方，背景统一 #FAFAFA。

## 播放

- 六格、每格 200 毫秒、5 fps、每轮 1.2 秒。无补帧、无缓动、无平滑插值。
- 第六格与第一格相同，形成循环回到悬停的停顿；保留分镜之间原有的跳动感。
- `rendered-stable-base/black-sesame-comic-3840.webp`：4K 无损循环动图。
- `rendered-stable-base/black-sesame-comic-1920.webp`：1080p 无损循环动图。
- `rendered-stable-base/black-sesame-comic-preview.gif`：960×540 循环预览。
- `rendered-stable-base/black-sesame-comic-4k.mp4`：4K、5 fps 视频；播放器需要开启循环。
- `rendered-stable-base/frames-4k/`：六张 PNG 分镜。
- `rendered-stable-base/storyboard.png`：六格总览。
- `source/preview.html`：离线预览。

## 素材与复现

透明素材由内置 image_gen 编辑原图生成。提示词见 `source/prompts.md`，素材在 `assets/`。在当前文件夹运行 `node source/build-comic.mjs` 重新导出，需要 Node.js、FFmpeg，不需要安装依赖。

生成素材为 1672×941；4K 文件是合成放大输出，不代表原生 4K 细节。精确背景色以 WebP 和 PNG 为准。上一版平滑动画保留在原目录，本版另存。
