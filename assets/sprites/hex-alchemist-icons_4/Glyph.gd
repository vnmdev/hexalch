@tool
class_name Glyph
extends Control

## Crisp icon with an optional halo behind it. Drop in, set tint + glow.

@export var icon: Texture2D: set = _set_icon
@export var halo: Texture2D: set = _set_halo
@export var tint: Color = Color.WHITE: set = _set_tint
@export_range(0.0, 1.5) var glow: float = 0.0: set = _set_glow
@export var icon_size: float = 32.0: set = _set_icon_size

var _halo := TextureRect.new()
var _icon := TextureRect.new()

func _ready() -> void:
	for t in [_halo, _icon]:
		t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		t.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(t)
	_halo.z_index = -1
	# Halo is additive so it reads as light, not as a grey smear.
	var m := CanvasItemMaterial.new()
	m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	_halo.material = m
	_refresh()

func _refresh() -> void:
	if not is_node_ready(): return
	_icon.texture = icon
	_halo.texture = halo
	_icon.modulate = tint
	_halo.modulate = Color(tint.r, tint.g, tint.b, glow)
	_halo.visible = halo != null and glow > 0.0
	custom_minimum_size = Vector2(icon_size, icon_size)
	_icon.size = Vector2(icon_size, icon_size)
	# Halo texture carries 30% padding, so it must be drawn larger to line up.
	var h := icon_size * 1.6
	_halo.size = Vector2(h, h)
	_halo.position = Vector2((icon_size - h) * 0.5, (icon_size - h) * 0.5)
	_icon.position = Vector2.ZERO

func _set_icon(v): icon = v; _refresh()
func _set_halo(v): halo = v; _refresh()
func _set_tint(v): tint = v; _refresh()
func _set_glow(v): glow = v; _refresh()
func _set_icon_size(v): icon_size = v; _refresh()
