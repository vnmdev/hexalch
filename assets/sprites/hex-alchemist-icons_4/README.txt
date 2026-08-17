HEX ALCHEMIST ICONS

No SVG in this pack contains a filter. Glow is never baked into a glyph --
it is always a separate pre-rasterised halo PNG in the glow/ subfolder.

  godot/          crisp, white. Tint at runtime with modulate.
  godot/glow/     white halo PNGs. Put BEHIND the icon, additive blend, 1.6x size.
  affinity/       crisp, coloured. Gradients intact. For design work and for
                  the metals + Stone tiers, which modulate cannot reproduce.
  affinity/glow/  coloured halo PNGs, same idea.
  source/         currentColor originals for web use.
  Palette.gd      every colour as a named constant.
  Glyph.gd        @tool Control that stacks halo + icon. Set icon, halo, tint, glow.

Halos carry 30% padding so the blur does not clip. Draw them at 1.6x the icon
size and re-centre -- Glyph.gd already does this.
