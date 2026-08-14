---
name: wouter layout nesting
description: How to wrap routes in a shared layout with wouter without blanking nested routes
---

To render a layout (sidebar/nav shell) around a group of routes in wouter, use a
**pathless catch-all** `<Route>` as the wrapper, with the nested `<Switch>` inside it:

```tsx
<Switch>
  <Route path="/shop-floor" component={ShopFloor} />
  <Route>            {/* pathless = matches anything, consumes nothing */}
    <NavShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/jobs" component={JobsList} />
        ...
      </Switch>
    </NavShell>
  </Route>
</Switch>
```

**Why:** a wildcard path like `<Route path="/:rest*">` *consumes* the matched path,
so the inner absolute routes then match against the leftover empty string and none
render — the page goes blank with no console error. A pathless `<Route>` matches
everything without consuming the path, so nested absolute routes still work.

**How to apply:** any time you need a shared layout around several pages, reach for
the pathless catch-all, not a param/wildcard path.
