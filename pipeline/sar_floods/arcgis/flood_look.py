"""Set up an ArcGIS Pro map for the owner's look at the flood maps (METHODS.md, "First results").

In ArcGIS Pro, with the project open: View > Python window, then paste one line (the path is this file's):

    exec(open(r"C:\\dev\\jaga\\pipeline\\sar_floods\\arcgis\\flood_look.py", encoding="utf-8").read())

It works on the active map of the open project: sets WGS 1984 UTM Zone 47N, adds the layers below in
a group "Jaga flood look" with the extent codes coloured, and saves nothing (save the project
yourself). It writes an attribute table (.vat.dbf) next to each coded raster and
a one-band copy of the two three-band rasters into out/sar_floods/arcgis_view/. Running it again replaces the group. Outside ArcGIS Pro it can be tried on a copy:

    propy flood_look.py <copy.aprx> [map name]

Needs ArcGIS Pro 3.x. Layers that are not on disk are skipped and listed.
"""

import os
import sys

import arcpy

OUT = r"C:\dev\jaga\pipeline\out" if "__file__" not in globals() else os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "out"))
HASH = "cd222f1"
GROUP = "Jaga flood look"

# value: (label, [R, G, B, alpha 0-100])
EXTENT = {
    0: ("0 · observed, not flooded", [255, 255, 255, 0]),
    1: ("1 · flooded, VV only", [43, 131, 186, 100]),
    2: ("2 · flooded, VH only (not counted)", [253, 141, 60, 100]),
    3: ("3 · flooded, VV and VH", [8, 48, 107, 100]),
    250: ("250 · masked: slope, HAND, layover or shadow", [140, 100, 60, 45]),
    251: ("251 · masked: permanent water", [166, 219, 237, 100]),
}
REASON = {
    0: ("0 · not masked by terrain", [255, 255, 255, 0]),
    1: ("1 · slope above 5° only", [253, 174, 97, 80]),
    2: ("2 · more than 15 m above drainage only (MERIT HAND)", [215, 25, 28, 90]),
    3: ("3 · both", [120, 120, 120, 45]),
}
BANDS = {"extent": 1, "n_valid": 2, "n_flooded": 3, "frequency": 1}
# (layer name, path under OUT, band or None, colours or stretch (min, max), visible), top of the group first.
LAYERS = [
    ("Pass 29 Nov 2024, 18:26 Bangkok (10 m)", rf"sar_floods\drive\jaga_sar_scene_20241129T1126Z_S1A_A172_10m_{HASH}.tif", None, EXTENT, True),
    ("Event Nov–Dec 2024, flooded in any pass (10 m)", rf"sar_floods\drive\jaga_sar_max_event-2024-nov-dec_10m_{HASH}.tif", "extent", EXTENT, False),
    ("Season 2024, flooded in any pass (20 m)", rf"sar_floods\products\jaga_sar_max_season-2024_20m_{HASH}.tif", "extent", EXTENT, False),
    ("Terrain mask: which rule (20 m)", r"sar_floods\diagnostics\jaga_diag_terrain_mask_reason_20m.tif", None, REASON, False),
    ("Flood frequency 2017–2025, share of valid passes (20 m)", rf"sar_floods\products\jaga_sar_frequency_2017-2025_20m_{HASH}.tif", "frequency", (0.0, 0.25), False),
    ("HAND from FABDEM, streams from 0.9 km² (30 m, metres)", r"hazard\work\hand_1000.tif", None, (0.0, 15.0), False),
]


def unique_values(layer, colours):
    sym = layer.symbology
    sym.updateColorizer("RasterUniqueValueColorizer")
    sym.colorizer.field = "Value"
    for group in sym.colorizer.groups:
        for item in group.items:
            label, rgba = colours.get(int(float(item.values[0])), (None, None))
            if label:
                item.label, item.color = label, {"RGB": rgba}
    layer.symbology = sym


def stretch(layer, low, high):
    sym = layer.symbology
    sym.updateColorizer("RasterStretchColorizer")
    layer.symbology = sym
    cim = layer.getDefinition("V3")
    c = cim.colorizer
    c.stretchType, c.statsType = "MinimumMaximum", "GlobalStats"
    c.useCustomStretchMinMax, c.customStretchMin, c.customStretchMax = True, low, high
    layer.setDefinition(cim)


def build(aprx, map_name=None):
    current = aprx.filePath == "CURRENT" or map_name is None and getattr(aprx, "activeMap", None) is not None
    m = aprx.listMaps(map_name)[0] if map_name else (aprx.activeMap if current and aprx.activeMap else
                                                    [x for x in aprx.listMaps() if x.mapType == "MAP"][0])
    m.spatialReference = arcpy.SpatialReference(32647)          # WGS 1984 UTM Zone 47N, the grid of every Jaga raster
    for old in [x for x in m.listLayers() if x.isGroupLayer and x.name == GROUP]:
        m.removeLayer(old)
    group = m.createGroupLayer(GROUP)
    done, skipped = [], []
    for name, rel, band, style, visible in reversed(LAYERS):
        path = os.path.join(OUT, rel)
        if not os.path.exists(path):
            skipped.append(rel)
            continue
        try:
            if isinstance(style, tuple):
                made = arcpy.management.MakeRasterLayer(path, name, band_index=str(BANDS[band]) if band else "")[0]
            else:
                if band:
                    # Unique values need an attribute table, which ArcGIS Pro only builds for a single-band
                    # raster: the band is copied once into OUT/sar_floods/arcgis_view/.
                    single = os.path.join(OUT, "sar_floods", "arcgis_view", os.path.basename(path)[:-4] + f"_{band}.tif")
                    if not os.path.exists(single):
                        os.makedirs(os.path.dirname(single), exist_ok=True)
                        one = arcpy.management.MakeRasterLayer(path, "jaga_tmp_band", band_index=str(BANDS[band]))[0]
                        arcpy.management.CopyRaster(one, single, pixel_type="8_BIT_UNSIGNED", nodata_value="255")
                        arcpy.management.Delete(one)
                    path = single
                # Without the table the colorizer lists all 256 values instead of the codes present.
                arcpy.management.BuildRasterAttributeTable(path, "NONE")
                made = arcpy.management.MakeRasterLayer(path, name)[0]
        except arcpy.ExecuteError:
            skipped.append(f"{rel}: ArcGIS Pro cannot read this raster")
            continue
        layer = m.addLayerToGroup(group, made, "TOP")[0]
        layer.name = name
        try:
            stretch(layer, *style) if isinstance(style, tuple) else unique_values(layer, style)
        except Exception as err:  # noqa: BLE001  the layer is still added, with default colours
            skipped.append(f"{name}: colours not applied ({err})")
        layer.visible = visible
        done.append(name)
    # A raster added whole shows three count bands as a meaningless RGB picture: switch those off.
    for other in m.listLayers():
        if (other.isRasterLayer and other.longName == other.name and other.supports("DATASOURCE")
                and "jaga_sar_max_" in other.dataSource and not other.dataSource.endswith(("extent", "n_valid", "n_flooded"))):
            other.visible = False
    print(f"Map '{m.name}': {m.spatialReference.name}; added {len(done)} layers to the group '{GROUP}'.")
    for line in skipped:
        print("  skipped:", line)
    return m


if __name__ == "__main__" and len(sys.argv) > 1:
    project = arcpy.mp.ArcGISProject(sys.argv[1])
    build(project, sys.argv[2] if len(sys.argv) > 2 else None)
    project.save()
else:
    build(arcpy.mp.ArcGISProject("CURRENT"))
