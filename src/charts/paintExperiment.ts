// THROWAWAY (pit-wall thread 1 #4645): switches for measuring what the web
// paint of a Compare chart costs. Read once from localStorage 'paint' (comma
// separated: nss, noclip, speed, nojoin). Never merged.
const raw = (() => {
  try {
    return typeof localStorage === 'undefined'
      ? ''
      : localStorage.getItem('paint') ?? '';
  } catch {
    return '';
  }
})();
const has = (k: string) => raw.split(',').includes(k) || raw === 'all';

export const paint = {
  /** Drop vectorEffect non-scaling-stroke. */
  nss: has('nss'),
  /** Drop the clipPath group around the series. */
  noclip: has('noclip'),
  /** shapeRendering optimizeSpeed on the lines. */
  speed: has('speed'),
  /** Drop strokeLinejoin round. */
  nojoin: has('nojoin'),
};
