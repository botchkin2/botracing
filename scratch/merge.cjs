const fs=require("fs");const p="src/charts/SeriesLines.tsx";let s=fs.readFileSync(p,"utf8");
const a=s.indexOf("  return (\n    <>\n      {wraps.map");const b=s.indexOf("export const SeriesLines");
const body=`  const wd = wraps.map(c => c.d).join('');
  const d = ds.map(c => c.d).join('');
  return (
    <>
      {wd === '' ? null : (
        <Path
          d={wd}
          stroke={color}
          strokeWidth={width}
          strokeOpacity={opacity * WRAP_OPACITY}
          strokeDasharray={dash}
          strokeLinejoin='round'
          vectorEffect='non-scaling-stroke'
          fill='none'
        />
      )}
      {fill == null || d === '' ? null : (
        <Path
          d={ds.map(c => areaPath(c.d, base)).join('')}
          fill={color}
          fillOpacity={fill * opacity}
        />
      )}
      {d === '' ? null : (
        <Path
          d={d}
          stroke={color}
          strokeWidth={width}
          strokeOpacity={opacity}
          strokeDasharray={dash}
          strokeLinejoin='round'
          vectorEffect='non-scaling-stroke'
          fill='none'
        />
      )}
    </>
  );
}

`;
fs.writeFileSync(p,s.slice(0,a)+body+s.slice(b));
