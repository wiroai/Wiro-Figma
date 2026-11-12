## Nano-Banana-2 Image Editing Tool

**Model:** `google/nano-banana-2`
**Description:** Generate and edit images on Gemini 3.1 Flash Image from 512px to 4K, with 14 references and 8:1 or 1:8 ratios. Try Nano Banana 2 by Google on Wiro now.
**Categories:** partner, google, image-to-image, quick-showcase, text-to-image, price-list, fast-inference, image-editing, use-agent, nogpu-pipeline

### Pricing (per output)

| resolution | Price  |
| ---------- | ------ |
| 512        | $0.045 |
| 1K         | $0.067 |
| 2K         | $0.101 |
| 4K         | $0.151 |

### Parameters

- **`inputImage`** (combinefileinput) (sample files on the model's page, used only by a workflow step that leaves it out)
  Input Image
  Example: `Input Image`
  Gemini 3.1 Flash Preview lets you to mix up to 14 reference images. These 14 images can include the following: Up to 10 images of objects with high-fidelity to include in the final image, up to 4 images of characters to maintain character consistency
  Pass an array of URLs directly: `inputImage: ["https://...", "https://..."]`. No upload needed.
- **`prompt`** (textarea) **(required)** (sample: `A top-down, realistic street photography shot of a tree surrounded by a circular rack of parked bicycles. Colorize the s...`, used only by a workflow step that leaves it out)
  prompt
  Example: `prompt`
  The prompt to generate the image.
- **`aspectRatio`** (select)
  Aspect Ratio
  Example: `Aspect Ratio`
  Aspect Ratio of the output image
  Options: `` (Match Input Image), `1:1` (1:1 (512)512x512 (1K)1024x1024 (2K)2048x2048 (4K)4096x4096), `1:4` (1:4 (512)256x1024 (1K)512x2048 (2K)1024x4096 (4K)2048x8192), `1:8` (1:8 (512)192x1536 (1K)384x3072 (2K)768x6144 (4K)1536x12288), `2:3` (2:3 (512)424x632 (1K)848x1264 (2K)1696x2528 (4K)3392x5056), `3:2` (3:2 (512)632x424 (1K)1264x848 (2K)2528x1696 (4K)5056x3392), `3:4` (3:4 (512)448x600 (1K)896x1200 (2K)1792x2400 (4K)3584x4800), `4:1` (4:1 (512)1024x256 (1K)2048x512 (2K)4096x1024 (4K)8192x2048), `4:3` (4:3 (512)600x448 (1K)1200x896 (2K)2400x1792 (4K)4800x3584), `4:5` (4:5 (512)464x576 (1K)928x1152 (2K)1856x2304 (4K)3712x4608), `5:4` (5:4 (512)576x464 (1K)1152x928 (2K)2304x1856 (4K)4608x3712), `8:1` (8:1 (512)1536x192 (1K)3072x384 (2K)6144x768 (4K)12288x1536), `9:16` (9:16 (512)384x688 (1K)768x1376 (2K)1536x2752 (4K)3072x5504), `16:9` (16:9 (512)688x384 (1K)1376x768 (2K)2752x1536 (4K)5504x3072), `21:9` (21:9 (512)792x168 (1K)1584x672 (2K)3168x1344 (4K)6336x2688)
- **`resolution`** (select) (default: `1K`)
  Resolution (K)
  Example: `Resolution`
  Default is 1K
  Options: `512` (512 (Standard)), `1K` (1K (Standard)), `2K` (2K (High)), `4K` (4K (Ultra High))
- **`safetySetting`** (select) (default: `OFF`)
  Safety Setting
  Example: `Safety Setting`
  Safety Setting
  Options: `BLOCK_LOW_AND_ABOVE`, `BLOCK_MEDIUM_AND_ABOVE`, `BLOCK_ONLY_HIGH`, `BLOCK_NONE`, `OFF`

### Usage

Use `run_model` with this model:

```json
{ "model": "google/nano-banana-2", "params": { ... } }
```
