---
type: report
created: 2026-05-28
source: "GPT Image 2 in Photoshop_ Create Images with Your ChatGPT Subscription _ Demo InpaintKit.mp4"
focus: "UI/UX, product flow, functional behavior"
---

# Video UI/UX Analysis — GPT Image 2 Photoshop InpaintKit Demo

## Summary

Demo shows InpaintKit as a Photoshop UXP plugin for full-canvas generation and selection-based inpainting with GPT Image 2 through a ChatGPT/OAuth backend. Core workflow works: prompt → progress → generated layer / edited layer. Biggest product risk is login friction and 100–150s generation wait interrupting creative iteration.

## UI Inventory

### Main Inpaint Dialog

- Title: `InpaintKit`.
- Model picker labeled `AI Model (ChatGPT)`.
- Selected model: `GPT Image 2`.
- Other visible models: `GPT Image 3`, `Seedream 4.0`, `Seedream 4.5 Lite`, `Nano Banana (Google)`, `Nano Banana 2 Pro (Google)`.
- Prompt textarea with placeholder: `Describe what you want to generate.`
- Recent prompt chips/buttons with truncated text.
- Optional reference images dropzone: `Click to browse files`; supports `.jpg`, `.png`, `.webp`.
- Buttons: `Cancel`, `Generate`.

### Progress State

- Messages shown:
  - `Uploading to AI servers...`
  - `Generating from pure imagination...`
- Estimate: `GPT Image 2 usually takes about 100-150 seconds.`
- Horizontal progress bar.
- Primary action becomes disabled `Generating...`.
- Cancel remains visible.

### Success State

- Brief success message: `Perfect! Your AI artwork is ready!`.
- Dialog returns to main state after placement.

### Settings Dialog

- Provider picker selected: `ChatGPT (OAuth)`.
- Auth states:
  - signed out: `Sign in with ChatGPT`.
  - signed in: account ID, expiry around 10 days, plugin login link, `Disconnect`.
- Buttons: `Cancel`, `Save Settings`.

### Browser OAuth Flow

- Device-code dialog in Photoshop shows code, copy action, open ChatGPT action, waiting state.
- Photoshop permission prompt asks to open `auth.openai.com/codedevice`.
- Browser flow includes OpenAI login, consent page, Codex device authorization warning, ChatGPT Security Settings toggle, code entry page, success page.

## User Flow Observed

### Full Canvas Generation

1. User creates blank Photoshop canvas.
2. Selects entire canvas.
3. Opens `Plugins > InpaintKit > Inpaint`.
4. Selects `GPT Image 2`.
5. Enters detailed prompt.
6. Clicks `Generate`.
7. Waits through upload and generation progress.
8. Result appears in Photoshop as a new layer.

### Selection Inpainting

1. User selects region on existing generated image, e.g. shoes or sword.
2. Opens `Plugins > InpaintKit > Inpaint`.
3. Keeps `GPT Image 2` selected.
4. Enters short prompt such as `change shoes color`.
5. Clicks `Generate`.
6. Waits through same progress state.
7. Edited region appears as a new non-destructive layer above original.

### ChatGPT Login

1. User opens `Plugins > InpaintKit > Settings`.
2. Chooses `ChatGPT (OAuth)`.
3. Clicks `Sign in with ChatGPT`.
4. Copies device code and opens browser.
5. Allows Photoshop to open external auth URL.
6. Logs into OpenAI.
7. Hits blocker: device code authorization for Codex must be enabled in ChatGPT Security Settings.
8. User navigates to settings, enables toggle, restarts login.
9. Pastes code, confirms consent, returns to Photoshop.
10. Settings shows signed-in state; user saves.

## Functional Behavior

- Supports text-to-image generation from prompt.
- Supports selection-based image editing/inpainting.
- Places generated output as a new Photoshop layer, preserving original content.
- Uses progress feedback and time estimate for slow GPT Image 2 jobs.
- Stores recent prompts for reuse.
- Includes reference image input, not demonstrated in video.
- ChatGPT backend uses OAuth/device-code style authorization with account expiry.

## UX Strengths

- Photoshop-native workflow; user does not leave editing context for generation itself.
- Non-destructive layer placement matches Photoshop mental model.
- Main dialog is simple and understandable.
- Progress state sets realistic wait expectation for GPT Image 2.
- Recent prompts reduce repeated typing.
- Reference image section hints at stronger creative control.
- Multiple model choices give flexibility.

## UX Issues

| Area | Issue | Impact |
|---|---|---|
| Authentication | ChatGPT login requires device-code flow plus hidden Codex security toggle. | High abandonment risk during onboarding. |
| Authentication | User may need to restart login after enabling security setting. | Feels broken even if technically expected. |
| Speed | 100–150s per generation/inpaint. | Breaks creative iteration loop. |
| Inpainting control | Prompt-only color edits lack color picker / target color control. | Result can be arbitrary; repeated generations likely. |
| Variations | Only one visible output generated. | Low choice for creative workflows. |
| Iteration | No visible `try again`, `refine`, `accept/discard`, or variation history in plugin. | User must manage Photoshop layers manually. |
| Model label | `AI Model (ChatGPT)` includes non-OpenAI model names. | Confusing provider/model relationship. |
| Recent prompts | Prompt chips truncate heavily. | Hard to identify past prompts. |
| Modal UX | Dialog flow appears modal. | Less smooth than dockable panel for repeated edits. |

## Recommendations

### High Priority

1. Add pre-login checklist for ChatGPT OAuth.
   - Explain Codex device authorization requirement before opening browser.
   - Link directly to the relevant ChatGPT Security Settings if possible.
   - Show `Step 1/3`, `Step 2/3`, `Step 3/3` to reduce confusion.

2. Improve OAuth recovery UX.
   - Detect the Codex authorization error and show a plugin-side recovery message.
   - Add `I enabled it, retry login` action instead of forcing user to rediscover the flow.
   - Auto-copy device code when opening browser.

3. Add iteration controls after generation.
   - `Retry`, `Refine prompt`, `Generate variations`, `Use result`, `Discard result`.
   - Keep last output available for placement retry if Photoshop placement fails.

4. Clarify model/provider language.
   - Rename label to `AI Model`.
   - Show provider separately: `Provider: ChatGPT Backend`, `Provider: fal.ai`, etc.
   - Add model descriptions/tooltips for strengths, speed, capabilities.

### Medium Priority

5. Add targeted inpainting controls.
   - Optional color picker for prompts that imply color changes.
   - Optional strength / preserve context control if backend supports it.
   - Prompt helper examples: `change selected shoes to matte red leather`.

6. Improve progress feedback.
   - Split progress into `Preparing selection`, `Uploading`, `Generating`, `Placing result`.
   - Show elapsed time and estimated remaining time if available.
   - Explain that GPT Image 2 is slow because it uses ChatGPT/backend generation.

7. Improve recent prompts.
   - Use dropdown or scrollable list with full text preview.
   - Add delete/clear action.
   - Group by model or task type if recent history grows.

8. Consider dockable UXP panel.
   - Better for iterative image editing than repeatedly opening a modal command.
   - Keep prompt/model/reference state visible while user edits selections.

### Lower Priority

9. Demonstrate reference images in onboarding/demo.
10. Add visible error state examples: timeout, auth expired, content policy, no selection, placement failure.
11. Add resolution/output-size controls if model registry already supports them.

## Product Takeaways

- The demo proves the core technical loop, but onboarding must be simplified before this feels consumer-ready.
- GPT Image 2 via ChatGPT subscription is valuable positioning, but the plugin needs stronger messaging around slow latency.
- Photoshop users expect fast iteration and layer control; post-generation actions matter as much as prompt input.
- Selection-based inpainting is the strongest workflow shown; improve controls around target color/material/style first.

## Unresolved Questions

- Can the plugin deep-link directly to ChatGPT Security Settings for the Codex device authorization toggle?
- Can ChatGPT session duration be extended beyond about 10 days?
- Does backend support multiple variations per request?
- Does backend expose color/seed/quality/style controls for GPT Image 2?
- What exact behavior happens on generation failure, timeout, cancellation, or placement failure?
- How should `GPT Image 2` vs `GPT Image 3` be described to users?
- Why are Google/Seedream models displayed under a ChatGPT-labeled model picker?
