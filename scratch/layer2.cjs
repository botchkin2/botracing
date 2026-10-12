const fs=require("fs");const p="src/charts/TraceChart.tsx";let s=fs.readFileSync(p,"utf8");
const must=(c,m)=>{if(!c)throw new Error(m)};
// y-only transform per series; x is the layer's.
must(s.includes("transform: `matrix(1 0 0 ${ky} ${-u0 * sx} ${at - ky * ab})`,"),"t");
s=s.replace("transform: `matrix(1 0 0 ${ky} ${-u0 * sx} ${at - ky * ab})`,","transform: `matrix(1 0 0 ${ky} 0 ${at - ky * ab})`,");
s=s.replace("  const paths = series.map((s, si) => {","  // The chunks drawn sit on a layer of their own (below), three windows wide;\n  // a frame moves that layer, so no path is re-recorded for it.\n  const layerBase = chunks[0] * width;\n  const layerW = chunks.length * width;\n  const layerX = layerBase - u0 * sx;\n  const paths = series.map((s, si) => {");
// cut the Defs + lines block
const a=s.indexOf("        <Defs>\n          <ClipPath id={clipId}>");
const b=s.indexOf("        {clipMarks.map(m => (");
must(a>0&&b>a,"blocks");
s=s.slice(0,a)+"      </ChartSvg>\n"+LAYER()+"      <ChartSvg width={width} height={height} pointerEvents='none'>\n"+s.slice(b);
function LAYER(){return `      {/* Values beyond the scale stop at the plot edge: the layer clips them. */}
      <View
        pointerEvents='none'
        style={[styles.plot, {width, height}]}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: layerW,
            height,
            transform: [{translateX: layerX}],
          }}>
          <Svg
            width={layerW}
            height={height}
            viewBox={\`\${layerBase} 0 \${layerW} \${height}\`}>
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
`}
s=s.replace("import {ClipPath, Defs, G, Line, Path, Rect} from 'react-native-svg';","import Svg, {G, Line, Path, Rect} from 'react-native-svg';");
s=s.replace("let clipSeq = 0;\n","");
s=s.replace("  // One clip per chart, so a series drawn past the scale stops at the plot edge.\n  const [clipId] = useState(() => `trace-clip-${++clipSeq}`);\n","");
s=s.replace("const styles = StyleSheet.create({","const styles = StyleSheet.create({\n  // The lines' window: the plot, clipped.\n  plot: {position: 'absolute', left: 0, top: 0, overflow: 'hidden'},");
fs.writeFileSync(p,s);
