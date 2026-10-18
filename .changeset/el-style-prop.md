---
"@directive-run/el": patch
---

`el()` props now accept `style` as a string or a partial style object (typed `ElProps`, exported). A string sets `style.cssText`; an object is assigned property by property. Previously an object style was assigned to `element.style` directly and produced `[object Object]`.
