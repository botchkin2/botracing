const fs=require("fs");const p="src/charts/TraceChart.tsx";let s=fs.readFileSync(p,"utf8");
s=s.replace(/style=\{\{\n\s*position: 'absolute',\n\s*left: 0,\n\s*top: 0,\n\s*width: layerW,\n\s*height,\n\s*transform: \[\{translateX: layerX\}\],\n\s*\}\}/,"style={[\n            styles.layer,\n            {width: layerW, height, transform: [{translateX: layerX}]},\n          ]}");
s=s.replace("  plot: {position: 'absolute', left: 0, top: 0, overflow: 'hidden'},","  plot: {position: 'absolute', left: 0, top: 0, overflow: 'hidden'},\n  layer: {position: 'absolute', left: 0, top: 0},");
fs.writeFileSync(p,s);
