# Oxidal sounds

Open **Library → Oxidal sounds** to find starting points for your own rigs.
Oxidal sounds are read-only examples. Editing one creates a copy in **Mine**
with **Make my copy**.

## The browser

Search by name, or filter by **Genre**, **Engine** and **Complexity**. Group the
list by genre or by engine. The summary line counts what you can play now.
Filters are remembered for the session.

Each card shows its genres, engine, complexity and one state. A card offers one
primary action for that state, plus **Details**.

| State          | Primary action      | What it means                                                          |
| -------------- | ------------------- | ---------------------------------------------------------------------- |
| Ready          | Play                | Built and everything it needs is installed. The card lists its scenes. |
| Not built      | Build               | Everything is installed; Build adds the preset to your library.        |
| Tones needed   | Get tones           | Needs tones from your TONE3000 account.                                |
| Sign-in needed | Sign in to TONE3000 | Tones are needed and no account is connected.                          |
| Packs needed   | Install pack        | Needs an [effect pack](device-service.md#effect-packs).                |
| Too heavy      | none                | More captures than the audio stream carries at the current buffer.     |
| Not available  | none                | This unit does not have a plugin the sound uses.                       |

Install pack is disabled, with the reason shown, while Protect is on or audio is
running. A heavy sound says at which buffer it would fit.

**Details** shows the description, an inspiration line, how to play it, the
scenes, the chain, what it needs and its load, and offers **Add to set list**
once the sound is ready. **Get tones** is one dialog for every tone a sound
still needs, with file sizes, and then builds the preset.

The capture budget is provisional: a 96-frame stream carries three distinct
Lite captures or two Full captures, in proportion to the buffer size. The
LV2 load shown in Details, about 1.5 % of a buffer per block, is a planning
figure. Neither is a measurement. See [capacity](capacity.md).

## Recipe metadata

Every sound carries these fields, shown on its card and in Details:

| Field                 | Meaning                                                          |
| --------------------- | ---------------------------------------------------------------- |
| Genres                | One to three from a fixed list of 17.                            |
| Techniques            | Routing and effect techniques, such as parallel routing or Hold. |
| Era                   | Songbook sounds only: 80s, 90s, 2000s or Modern.                 |
| Engine                | LV2 only, TONE3000 · A2 Lite, TONE3000 · A2 Full or Hybrid.      |
| Complexity            | Simple, Layered or Complex.                                      |
| Inspiration           | A style and an era. Never an artist, a band or a song.           |
| Performance           | How the scenes are meant to be used live.                        |
| Required packs, tones | Derived from the sound's blocks and voices.                      |
| Block count, captures | Derived: processing blocks and simultaneous NAM instances.       |

## Showcase tiers

The collection holds 131 recipes. The newest 71 are the showcase, built in
four tiers:

| Tier               | Sounds | Needs                                                  |
| ------------------ | ------ | ------------------------------------------------------ |
| LV2 only           | 29     | Effect packs only. No captures.                        |
| TONE3000 · A2 Lite | 15     | Your own NAM tones from TONE3000, at the lighter size. |
| TONE3000 · A2 Full | 10     | Your own NAM tones from TONE3000, at the full size.    |
| Hybrid             | 17     | A capture plus LV2 effects.                            |

The rest are earlier effects recipes, the songbook and tool recipes. Thirteen
earlier recipes were retired because a showcase sound of the same name replaces
them; they no longer appear.

## First boot and nothing third-party

A fresh appliance image installs the 29 LV2-only showcase presets in Library on
first boot. They need no captures. Nothing third-party is bundled: no NAM
captures, no IRs and no TONE3000 downloads. You install tones from your own
account through **Get tones**. A recipe asks for a named voice, such as a clean
or driven amp. Choose a compatible tone to fill the slot.

## Dependencies

- If a sound is missing an effect, install the pack it lists from the card or in
  **Settings → Effects**. See [effect packs](device-service.md#effect-packs).
- The collection uses effects from Guitarix, Invada, MDA, SWH, x42, FOMP, Calf
  and Dragonfly, plus Oxidal Hold, Pitch and Swell.

## Signal layout and switching

Most sounds have four scenes. Some use routed paths or longer serial chains.
Play through the finished rig and check levels and processing headroom before
using it live. See [mixed rigs and scenes](mixed-engine.md).

## References

- [Showcase recipe definitions](../apps/web/src/recipes/lv2Showcase.ts)
- [Recipe catalog](../apps/web/src/factoryCatalog.ts)
- [Recipe metadata](../apps/web/src/factoryMetadata.ts)
- [Appliance image setup](../os/README.md)
