# Development Guides

This directory contains guides for common development issues and best practices in this React Native Web racing analytics application.

Talk, plans, and half-formed ideas live in the pit wall, `C:UsersBotkinProjectspit-wall` (its own local repo). New people start at `pit-wall/JOIN.md`. A note here is reference. A note there is a conversation.

## 📚 Available Guides

### [API Requests](./API_REQUESTS.md)

**Fixing redundant API calls and request deduplication**

- Multiple identical requests to same endpoints
- HMR-safe caching strategies
- Component lifecycle optimization

### [React Query](./REACT_QUERY.md)

**Best practices for TanStack Query usage**

- Query key stability and caching
- Memoization patterns
- Common pitfalls and solutions

### [Component Optimization](./COMPONENT_OPTIMIZATION.md)

**Performance optimization for React components**

- React.memo usage
- useMemo and useCallback patterns
- State batching techniques

### [LMU sync](./LMU_SYNC_NOTES.md)

**Where Le Mans Ultimate laps live on this PC, and the plan to get them into the app**

- DuckDB recordings, the CSV columns the chart already parses, and the unit conversions
- Dev tools installed on this machine
- The six-step plan for the sync script

### [Major upgrades](./MAJOR_UPGRADES.md)

**Major-version bumps held back from Dependabot, with their blockers**

- ureq 3, firebase-admin 14, eslint 10: what blocks each and what its PR must prove

### [React Native Web](./REACT_NATIVE_WEB.md)

**Web-specific optimizations and compatibility**

- Style prop differences
- Animation compatibility
- Platform-specific handling

## 🎯 Quick Fixes

### Redundant API Calls

```bash
# Check: Multiple identical network requests in dev tools
# Fix: Implement global request cache + component memoization
# See: API_REQUESTS.md
```

### Component Re-renders

```bash
# Check: Console logs showing excessive renders
# Fix: React.memo + useMemo for expensive computations
# See: COMPONENT_OPTIMIZATION.md
```

### Web Compatibility Issues

```bash
# Check: Animation warnings, style errors
# Fix: useNativeDriver: false, correct style props
# See: REACT_NATIVE_WEB.md
```

## 📋 Development Checklist

Before deploying new features:

- [ ] API requests are deduplicated
- [ ] Components use React.memo appropriately
- [ ] Animations work on web (useNativeDriver: false)
- [ ] Styles use web-compatible props
- [ ] No console.log statements in production
- [ ] Query keys are stable and memoized

## 🔗 Related Files

- `PERFORMANCE_TIPS.md` - Comprehensive troubleshooting guide
- `docs/REACT_QUERY.md` - React Query keys and caching
- `src/data/` - API client, keys, query hooks and adapters per resource

---

_Last updated: January 30, 2026_
