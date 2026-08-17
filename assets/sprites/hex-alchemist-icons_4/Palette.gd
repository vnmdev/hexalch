class_name Palette
extends RefCounted

# Hex Alchemist palette. Multiply a colour by >1.0 only if you have
# HDR 2D + WorldEnvironment glow on; otherwise use the glow/ halo textures.

const CRUCIBLE := Color("14100c")   # the intended background. Icons are tuned to this.
const ASH      := Color("1e1811")
const EDGE     := Color("2b2419")
const VELLUM   := Color("e6ddc9")
const DIM      := Color("8d7f6a")

const FIRE  := Color("d4552a")
const WATER := Color("2f7d94")
const AIR   := Color("b8c4b4")
const EARTH := Color("6f7a3c")

const SULPHUR := Color("a89a1c")
const MERCURY := Color("7fa3d6")
const SALT    := Color("ded6c4")

# Metals are two-stop. Use MID for flat tinting, HI/LO if you build a gradient.
const SILVER_HI := Color("fbfeff"); const SILVER_LO := Color("bccacf"); const SILVER := Color("dbe4e7")
const TIN_HI    := Color("8f96a4"); const TIN_LO    := Color("4c5361"); const TIN    := Color("6d7482")
const IRON_HI := Color("aab4c0"); const IRON_LO := Color("5f6a78"); const IRON := Color("848f9c")
const LEAD_HI   := Color("6f6874"); const LEAD_LO   := Color("2f2b37"); const LEAD   := Color("4f4a55")
const COPPER_HI := Color("8a6a52"); const COPPER_LO := Color("48301c"); const COPPER := Color("694d37")
const GOLD_HI := Color("fff0bd"); const GOLD_LO := Color("dda81f"); const GOLD := Color("eecc6e")
const QUICKSILVER_HI := Color("b3c3d8"); const QUICKSILVER_LO := Color("5d7899"); const QUICKSILVER := Color("889db8")
# MERCURY (above) is the refined prime. QUICKSILVER is the mined metal. Same glyph.

const PHIL_SULPHUR := Color("6fc44a")
const QUINTESSENCE := Color("cfc2ec")
const ALKAHEST     := Color("e0479c")

const BLACK_SULPHUR := Color("a84d5e")
const BLACK_MERCURY := Color("5f76a0")
const BLACK_SALT    := Color("93897c")

# The Stone, one per stage of the Great Work.
const NIGREDO    := Color("332e26")
const ALBEDO     := Color("c6bfaf")
const CITRINITAS := Color("d1a43b")
const RUBEDO     := Color("bb4832")
const STONE_TIERS := [NIGREDO, ALBEDO, CITRINITAS, RUBEDO]

# The nobility ladder. Single source of truth for transmutation order.
const NOBILITY := ["lead","tin","iron","copper","quicksilver","silver","gold"]

# Halo strength per metal. Muted band is 0.0 -- exactly what the Nigredo stone can reach.
const RADIANCE := {"lead":0.0,"tin":0.0,"iron":0.0,"copper":0.0,"quicksilver":0.0,
	"silver":0.45,"gold":0.75,"platinum":0.9}
