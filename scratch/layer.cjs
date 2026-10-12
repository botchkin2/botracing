const fs=require("fs");const p="src/charts/TraceChart.tsx";let s=fs.readFileSync(p,"utf8");
// 1) y-only transform per series; x handled by the layer.
s=s.replace("transform: `matrix(1 0 0 ${ky} ${-u0 * sx} ${at - ky * ab})`,","transform: `matrix(1 0 0 ${ky} 0 ${at - ky * ab})`,");
// 2) layer geometry
s=s.replace("  const paths = series.map((s, si) => {","  const layerBase = chunks[0] * width;\n  const layerW = chunks.length * width;\n  const layerX = layerBase - u0 * sx;\n  const paths = series.map((s, si) => {");
// 3) remove lines block from main svg
const a=s.indexOf("        {/* Values beyond the scale are drawn clipped");
const b=s.indexOf("        {clipMarks.map(m => (");
const lines=s.slice(a,b);
s=s.slice(0,a)+s.slice(b);
// 4) insert layer View before ChartSvg
const layer=`      {/* The lines sit on their own layer, wide enough for the chunks drawn;
          a frame moves the layer's view, not every path in an svg. */}
      <View
        pointerEvents='none'
        style={{position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden'}}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: layerW,
            height,
            transform: [{translateX: layerX}],
          }}>
          <Svg width={layerW} height={height} viewBox={\`\${layerBase} 0 \${layerW} \${height}\`}>
            {paths.map(p => (
              <G key={p.key} transform={p.transform}>
                <SeriesLines
                  ds={p.ds}
                  wraps={p.wraps}
                  color={p.color}
                  width={p.width}
                  opacity={p.opacity}
                  dash={p.dash}
                  fill={p.fill}
                  base={p.base}
                />
              </G>
            ))}
          </Svg>
        </View>
      </View>
`;
s=s.replace("      <ChartSvg width={width} height={height + AXIS_H} pointerEvents='none'>",layer+"      <ChartSvg width={width} height={height + AXIS_H} pointerEvents='none'>");
s=s.replace("import {ClipPath, Defs, G, Line, Path, Rect} from 'react-native-svg';","import Svg, {ClipPath, Defs, G, Line, Path, Rect} from 'react-native-svg';");
fs.writeFileSync(p,s);console.log(lines.length);
