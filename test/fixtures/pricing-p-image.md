## P-Image

**Model:** `pruna/p-image`
**Description:** Turn a written prompt into one image with P-Image, which Pruna built for exact prompt adherence and text inside the frame. Try P-Image by Pruna on Wiro now.
**Categories:** use-agent, quick-showcase, partner, pruna, text-to-image, fast-inference, nogpu-pipeline

### Pricing (per request)

$0.005 / per request

### Parameters

- **`prompt`** (textarea) **(required)** (sample: `A documentary-quality wildlife photograph of a white Arctic Fox curled up on a snow-covered ridge during a light blizzar...`, used only by a workflow step that leaves it out)
  prompt
  Example: `prompt`
- **`aspectRatio`** (select) (default: `16:9`)
  Aspect Ratio
  Example: `Aspect Ratio`
  Options: `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `1:1`
- **`seed`** (text) (a run picks a random seed when it is left out or 0)
  Seed
  Example: `Seed`
  Random seed. Leave zero to randomize the seed
- **`disableSafetyChecker`** (select) (default: `false`)
  Safety Checker
  Example: `Safety Checker`
  Disable safety checker for generated images
  Options: `true` (True), `false` (False)

### Usage

Use `run_model` with this model:

```json
{ "model": "pruna/p-image", "params": { ... } }
```
