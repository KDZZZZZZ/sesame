# 手绘黑芝麻循环动画

4 秒循环，30 fps，背景 #FAFAFA。保留墨线与水彩色块的手绘风格，全部改成黑芝麻。芝麻堆固定，细小颗粒从画面上方落入堆后方，完全遮挡后才重置。

## 直接使用

- `rendered/black-sesame-3840.webp`：3840×2160，无损循环动图，推荐用于高清显示。
- `rendered/black-sesame-2560.webp`：2560×1440，无损循环动图，适合网页。
- `rendered/black-sesame-1920.webp`：1920×1080，更小的无损循环动图。
- `rendered/black-sesame-4k.mp4`：3840×2160 视频，播放端需打开循环。
- `rendered/black-sesame-preview.gif`：960×540 预览动图。
- `rendered/keyframes-4k/`：六张 3840×2160 PNG 关键帧。
- `rendered/black-sesame-poster-4k.png`：静态封面。
- `source/preview.html`：离线循环预览。

## 素材与复现

素材由内置 image_gen 工具生成，最终提示词保存在 `source/prompts.md`。透明原始素材位于 `assets/`；导出命令与配置说明见 `source/README.md`。没有修改原始附图，也没有修改应用业务代码。

4K 为合成输出尺寸。堆图原始素材 1672×941，裁取紧凑主体后高质量缩放到画布；不应表述为原生 4K 生成素材。WebP、PNG 保留精确背景色；MP4 为兼容播放使用有损 YUV 编码。

## 验证

无损母版共 120 帧。首尾帧逐像素相同；三次落粒各自重置前的两帧与静态堆图逐像素相同，说明重置发生在完全遮挡之后。最终动图的尺寸、时长、循环标记、背景色及固定堆体检查见 `rendered/delivery-verification.json`。
