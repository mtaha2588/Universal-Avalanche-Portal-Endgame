Batura avalanche 3D files
=========================
batura_terrain_and_path.glb  terrain + avalanche path, vertex colours. Blender: File > Import > glTF 2.0.
batura_terrain.obj           same terrain as OBJ with vertex colours (MeshLab, Blender).
avalanche_path.obj           path centre line (polyline).
avalanche_path_with_time.csv path points with time (s) and speed (m/s): use it to animate an object along the path.
daily_factors_window.csv     daily factor values and the condition index for the 53 days.
avalanche_features.geojson   path, release, run-out, ERA5 tiles (QGIS, Google Earth via conversion, kepler.gl).
*.tif                        DEM, slope, aspect, release score and zone in EPSG:4326 (QGIS, Blender GIS).

Mesh coordinates: metres, Y up. X = east, Y = elevation above sea level, Z = south (north is -Z).
Origin: centre of the terrain grid, lon 74.59969, lat 36.58034.
Grid: 522 x 332 cells of 120 m. Vertical exaggeration: none (apply it in your 3D program).
