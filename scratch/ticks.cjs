const fs=require("fs");const p="src/charts/FollowMap.tsx";let s=fs.readFileSync(p,"utf8");
const a=s.indexOf("      {ticks.flatMap(t =>");
const b=s.indexOf("    </>\n  );\n});",a);
const body=`      {tickPaths.map(t => (
        <Path
          key={t.key}
          d={t.d}
          stroke={t.color}
          strokeWidth={TICK_W}
          vectorEffect='non-scaling-stroke'
          fill='none'
        />
      ))}
`;
s=s.slice(0,a)+body+s.slice(b);
s=s.replace("  return (\n    <>\n      {fadedPaths.map","  const tickPaths = useMemo(\n    () =>\n      ticks.map(t => ({\n        key: t.key,\n        color: t.color,\n        d: t.ticks\n          .map(([a, b]) => `M${a.x},${a.y}L${b.x},${b.y}`)\n          .join(''),\n      })),\n    [ticks],\n  );\n  return (\n    <>\n      {fadedPaths.map");
fs.writeFileSync(p,s);
