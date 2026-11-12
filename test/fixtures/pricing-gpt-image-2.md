## OpenAI GPT Image 2: Generation and Edits

**Model:** `openai/gpt-image-2`
**Description:** GPT Image 2 makes images and precise edits with sharp text and up to 4K output. Ideal for product shots and inpainting. Try GPT Image 2 by OpenAI on Wiro now.
**Categories:** partner, openai, text-to-image, image-to-image, image-editing, nogpu-pipeline

### Pricing (per request)

| quality | resolution | ratio | Price  |
| ------- | ---------- | ----- | ------ |
| low     | 1k         | 1:1   | $0.006 |
| low     | 1k         | 3:2   | $0.005 |
| low     | 1k         | 2:3   | $0.005 |
| low     | 1k         | 4:3   | $0.005 |
| low     | 1k         | 3:4   | $0.005 |
| low     | 1k         | 16:9  | $0.003 |
| low     | 1k         | 9:16  | $0.003 |
| medium  | 1k         | 1:1   | $0.053 |
| medium  | 1k         | 3:2   | $0.041 |
| medium  | 1k         | 2:3   | $0.041 |
| medium  | 1k         | 4:3   | $0.042 |
| medium  | 1k         | 3:4   | $0.042 |
| medium  | 1k         | 16:9  | $0.028 |
| medium  | 1k         | 9:16  | $0.028 |
| high    | 1k         | 1:1   | $0.211 |
| high    | 1k         | 3:2   | $0.165 |
| high    | 1k         | 2:3   | $0.165 |
| high    | 1k         | 4:3   | $0.167 |
| high    | 1k         | 3:4   | $0.167 |
| high    | 1k         | 16:9  | $0.114 |
| high    | 1k         | 9:16  | $0.114 |
| low     | 2k         | 1:1   | $0.012 |
| low     | 2k         | 3:2   | $0.008 |
| low     | 2k         | 2:3   | $0.008 |
| low     | 2k         | 4:3   | $0.007 |
| low     | 2k         | 3:4   | $0.007 |
| low     | 2k         | 16:9  | $0.005 |
| low     | 2k         | 9:16  | $0.005 |
| medium  | 2k         | 1:1   | $0.107 |
| medium  | 2k         | 3:2   | $0.067 |
| medium  | 2k         | 2:3   | $0.067 |
| medium  | 2k         | 4:3   | $0.067 |
| medium  | 2k         | 3:4   | $0.067 |
| medium  | 2k         | 16:9  | $0.042 |
| medium  | 2k         | 9:16  | $0.042 |
| high    | 2k         | 1:1   | $0.428 |
| high    | 2k         | 3:2   | $0.269 |
| high    | 2k         | 2:3   | $0.269 |
| high    | 2k         | 4:3   | $0.267 |
| high    | 2k         | 3:4   | $0.267 |
| high    | 2k         | 16:9  | $0.17  |
| high    | 2k         | 9:16  | $0.17  |
| low     | 4k         | 1:1   | $0.02  |
| low     | 4k         | 3:2   | $0.013 |
| low     | 4k         | 2:3   | $0.013 |
| low     | 4k         | 4:3   | $0.014 |
| low     | 4k         | 3:4   | $0.014 |
| low     | 4k         | 16:9  | $0.011 |
| low     | 4k         | 9:16  | $0.011 |
| medium  | 4k         | 1:1   | $0.178 |
| medium  | 4k         | 3:2   | $0.115 |
| medium  | 4k         | 2:3   | $0.115 |
| medium  | 4k         | 4:3   | $0.125 |
| medium  | 4k         | 3:4   | $0.125 |
| medium  | 4k         | 16:9  | $0.1   |
| medium  | 4k         | 9:16  | $0.1   |
| high    | 4k         | 1:1   | $0.712 |
| high    | 4k         | 3:2   | $0.459 |
| high    | 4k         | 2:3   | $0.459 |
| high    | 4k         | 4:3   | $0.502 |
| high    | 4k         | 3:4   | $0.502 |
| high    | 4k         | 16:9  | $0.4   |
| high    | 4k         | 9:16  | $0.4   |

### Parameters

- **`inputImage`** (combinefileinput) (sample files on the model's page, used only by a workflow step that leaves it out)
  Input Images
  Example: `Input Images`
  Optional. Input images to edit, up to 16.
  Pass an array of URLs directly: `inputImage: ["https://...", "https://..."]`. No upload needed.
- **`prompt`** (textarea) **(required)** (sample: `A hyper-detailed, high-resolution photographic edit based on image. The clear rocks glass, the metallic spoon, and the r...`, used only by a workflow step that leaves it out)
  Prompt
  Example: `Enter your prompt...`
  Required. Text description of the desired image or image edit. Maximum 32,000 characters.
- **`inputImageMask`** (combinefileinput)
  Mask Image (Edit)
  Example: `Mask Image (Edit only)`
  Optional. Requires input image(1). Mask image to define specific areas to edit.
  Pass an array of URLs directly: `inputImageMask: ["https://...", "https://..."]`. No upload needed.
- **`resolution`** (select) **(required)** (sample: `1k`, used only by a workflow step that leaves it out)
  Resolution
  Example: `Resolution`
  Required. Output resolution tier.
  Options: `1k` (1K (~1 MP)), `2k` (2K (~2-4 MP, experimental)), `4k` (4K (~8 MP, experimental))
- **`ratio`** (select) **(required)** (sample: `1:1`, used only by a workflow step that leaves it out)
  Ratio
  Example: `Ratio`
  Required. Aspect ratio of the output image.
  Options: `1:1` (1:1 (square) — 1024x1024(1k) / 2048x2048(2k) / 2880x2880(4k)), `3:2` (3:2 (landscape) — 1536x1024(1k) / 2400x1600(2k) / 3456x2304(4k)), `2:3` (2:3 (portrait) — 1024x1536(1k) / 1600x2400(2k) / 2304x3456(4k)), `4:3` (4:3 (landscape) — 1280x960(1k) / 2048x1536(2k) / 3200x2400(4k)), `3:4` (3:4 (portrait) — 960x1280(1k) / 1536x2048(2k) / 2400x3200(4k)), `16:9` (16:9 (landscape) — 1280x720(1k) / 2048x1152(2k) / 3840x2160(4k)), `9:16` (9:16 (portrait) — 720x1280(1k) / 1152x2048(2k) / 2160x3840(4k))
- **`quality`** (select) **(required)** (sample: `low`, used only by a workflow step that leaves it out)
  Quality
  Example: `Quality`
  Required. Output image quality.
  Options: `low` (Low), `medium` (Medium), `high` (High)
- **`background`** (select) (default: `auto`)
  Background
  Example: `Background`
  Optional. Background setting.
  Options: `auto` (Auto), `opaque` (Opaque)
- **`outputFormat`** (select) (default: `png`)
  Output Format
  Example: `Output Format`
  Optional. Output image format. Defaults to png.
  Options: `png` (PNG), `jpeg` (JPEG), `webp` (WEBP)
- **`outputCompression`** (number) (default: `100`)
  Output Compression
  Example: `Output Compression (0-100)`
  Optional. Compression level (0-100) for jpeg or webp output only. Defaults to 100.
  Range: 0 to 100, step 1
- **`samples`** (number) **(required)** (sample: `1`, used only by a workflow step that leaves it out)
  Number of Images
  Example: `Number of Images`
  Required. Number of images to generate (1-10).
  Range: 1 to 10, step 1
- **`moderation`** (select) (default: `low`)
  Moderation Level
  Example: `Moderation Level`
  Optional. Content moderation level.
  Options: `auto` (Auto), `low` (Low)

### Usage

Use `run_model` with this model:

```json
{ "model": "openai/gpt-image-2", "params": { ... } }
```
