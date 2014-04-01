CropCanvas
===========

A `<canvas>`-based image cropping jQuery plugin.

This plugin is based on Simon Sarris's tutorial and code found at http://simonsarris.com/blog/510-making-html5-canvas-useful.

Usage
-----------

```javascript
$(function() {
  var canvas = $('#my-canvas');
  canvas.cropCanvas({
    marqueeType: 'ellipse',
    constrain: true,
    src: 'path/to/my/image.png'
  });
});
```
