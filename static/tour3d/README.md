# 3D Cinematic Tour: terrain

The tour (`/tour3d`, `static/tour3d/tour3d.js`) draws its mountains from one setting at the top of `tour3d.js`:

```js
terrain: "world",        // Cesium World Terrain (default)
terrain: "ion:1234567",  // your own DEM, uploaded to Cesium ion (asset id)
terrain: "/static/terrain/hunza/",  // your own DEM as self-hosted quantized-mesh tiles
exaggeration: 1.0,       // 1.0 = true relief; set e.g. 1.3 to enable vertical exaggeration
```

Nothing else needs to change. Also update `terrainNote` (the credit line on screen) to name the new source and its resolution.

## How detailed is the default terrain?

Cesium World Terrain does not publish its resolution per area. Over northern Pakistan, treat it as roughly 30 m source data
(SRTM / Copernicus class). Cliffs, narrow couloirs and sharp ridges are smoother than they are in reality. The satellite imagery is
draped straight down, so on very steep faces it looks stretched. That is how the data is, not a rendering fault, and the tour adds no
texture that would suggest more detail than the data has.

## Option A: upload a GeoTIFF DEM to Cesium ion (easiest)

1. Sign in at https://ion.cesium.com and choose **Add data**, then upload the GeoTIFF (for example the 8 m High Mountain Asia DEM tile
   for Batura / Hunza, or Copernicus GLO-30). Choose **Terrain** as the kind of data; base terrain: Cesium World Terrain, so your tile
   is blended into the world terrain around it.
2. When tiling has finished, copy the asset id.
3. Set `terrain: "ion:<asset id>"` in `tour3d.js`. The token in `.env` (`CESIUM_ION_TOKEN`) must be allowed to use that asset (in ion:
   Access Tokens, then the token, then the asset list).

Your upload counts against the ion account's storage; streaming counts against its monthly quota.

## Option B: self-host quantized-mesh tiles (no quota)

1. Reproject the DEM to EPSG:4326 and make the nodata value explicit:
   `gdalwarp -t_srs EPSG:4326 -dstnodata -9999 hma_8m.tif hma_8m_4326.tif`
2. Build the tiles with Cesium Terrain Builder, for example the `tumgis/ctb-quantized-mesh` Docker image:
   ```
   docker run -v %cd%:/data tumgis/ctb-quantized-mesh ctb-tile -f Mesh -C -N -o /data/terrain /data/hma_8m_4326.tif
   docker run -v %cd%:/data tumgis/ctb-quantized-mesh ctb-tile -f Mesh -C -N -l -o /data/terrain /data/hma_8m_4326.tif
   ```
   The second command writes `layer.json`. `-N` adds vertex normals for the terrain lighting.
3. Copy the `terrain` folder to `static/terrain/<name>/` and set `terrain: "/static/terrain/<name>/"`. The tiles are gzip-compressed:
   serve them with `Content-Encoding: gzip`, or build them without `-C`.

A self-hosted DEM covers only its own extent: outside it Cesium shows the ellipsoid. For a single area (Batura and Hunza) Option A,
blended into the world terrain, is usually better.
