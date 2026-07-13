# Middle-truncate Artifact card names design

## Context

The grid card footer currently renders the full name in one `truncate` span, so overflow removes only the end. Artifact names are limited to 120 characters, but visible capacity depends on card width and glyph width rather than character count.

## Goals / Non-Goals

**Goals:** Preserve recognizable head and distinguishing tail content on grid cards, expose the complete name, and keep the title to one line.

**Non-Goals:** Changing stored names, the 120-character limit, list view, detail view, card width, or navigation.

## Decisions

- Split every name at a 2:1 head-to-tail ratio, without a character-count threshold. Render the head as a shrinkable CSS ellipsis segment and the tail as a fixed segment. When the complete name fits, the two segments join without an ellipsis; when the actual rendered width overflows, CSS inserts the ellipsis between them. This handles Chinese, Latin, and mixed-width names without guessing visible capacity from character count.
- Put the complete name in the grid title's native `title` tooltip; retain the full card anchor `aria-label`. This preserves the existing pointer-event boundary that makes the whole card clickable.

## Risks / Trade-offs

- **[Risk] Extremely wide tail glyphs can consume most of the row.** → Cap the tail segment to one third of the title row.
- **[Trade-off] The split is character-based before CSS width handling.** → Use the split only to select semantic head and tail portions; CSS remains responsible for fitting them.

## Open Questions

None.
