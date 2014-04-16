/**
 * CanvasCrop is a jQuery plugin that uses <canvas> to allow basic image cropping.
 * Thanks to Simon Sarris for inspiration/code: http://simonsarris.com/blog/510-making-html5-canvas-useful
 *
 * @author Greg Kuwaye
 * @license MIT License - http://www.opensource.org/licenses/mit-license.php
 */
(function(factory) {
  if (typeof define === 'function' && define.amd) {
    define(['jquery'], factory);
  } else {
    factory(jQuery);
  }
}(function($) {
  var CanvasCrop,
      Shape,
      Rectangle,
      Ellipse;

  /**
   * @param {HTMLElement} canvas
   * @param {object} options
   * @constructor
   */
  CanvasCrop = function(canvas, options) {
    var computedStyle = window.getComputedStyle(canvas, null);

    this.canvas  = canvas;
    this.$canvas = $(canvas);
    this.$window = $(window);
    this.options = $.extend({}, CanvasCrop.DEFAULTS, options);
    this.context = canvas.getContext('2d');
    this.image = null;
    this.marquee = null;

    this.state = {
      canvas: {
        paddingLeft: parseInt(computedStyle.getPropertyValue('padding-left')),
        paddingTop: parseInt(computedStyle.getPropertyValue('padding-top')),
        borderTop: parseInt(computedStyle.getPropertyValue('border-top-width')),
        borderLeft: parseInt(computedStyle.getPropertyValue('border-left-width'))
      },
      repositioning: false,
      repositioningCoords: {
        x: null,
        y: null
      },
      repositioningOffset: {
        x: null,
        y: null
      },
      resizing: false,
      resizingCoords: {
        x: null,
        y: null
      },
      shiftKey: false
    };

    this.init();
  };

  /**
   * marqueeType: "rectangle" or "ellipse"
   * constrain:   Constrain marquee ratio to 1:1 (square/circle)
   * src:         The path to the image
   *
   * @type {{marqueeType: string, constrain: boolean, src: string}}
   */
  CanvasCrop.DEFAULTS = {
    marqueeType: 'rectangle', // rectangle, ellipse
    constrain: true,
    src: '',
    enableRawDataOutput: false
  };

  /**
   * Bootstraps the process.
   */
  CanvasCrop.prototype.init = function() {
    var self = this;

    this.$canvas
        .on('mousedown', $.proxy(this.handleMousedown, this))
        .on('mousemove', $.proxy(this.handleMousemove, this))
        .css('cursor', 'crosshair');

    this.$window
        .on('mouseup', $.proxy(this.handleMouseup, this))
        .on('keyup keydown', function(e) {
          self.state.shiftKey = e.shiftKey;
          return true;
        });

    this.drawBackground();
  };

  CanvasCrop.prototype.handleMousedown = function(e) {
    var mouse = this.getMouse(e),
        state = this.state;

    // Mouse was pressed while inside a visible marquee.
    if (this.marquee && this.marquee.contains(mouse.x, mouse.y)) {
      state.repositioning = true;
      state.resizing = false;
      state.repositioningOffset.x = mouse.x - this.marquee.x;
      state.repositioningOffset.y = mouse.y - this.marquee.y;
    } else {
      state.repositioning = false;
      state.resizing = true;
    }
  };

  CanvasCrop.prototype.handleMouseup = function(e) {
    var cropCoords;

    // If we were just repositioning or resizing a box, report the final crop size.
    if (this.state.repositioning || this.state.resizing) {
      this.$canvas.trigger($.Event('crop.finish', {coordinates: this.getCropCoordinates(true)}));

      // Have we enabled raw data output?
      if (this.options.enableRawDataOutput) {
        this.$canvas.trigger($.Event('crop.data', {rawData: this.getRawCroppedImageData()}));
      }
    }

    this.state.repositioning = false;
    this.state.resizing = false;
  };

  CanvasCrop.prototype.handleMousemove = function(e) {
    var state = this.state,
        mouse = this.getMouse(e);

    if (this.marquee) {
      if (this.marquee.contains(mouse.x, mouse.y)) {
        this.$canvas.css('cursor', 'move');
      } else {
        this.$canvas.css('cursor', 'crosshair');
      }
    }

    // Nothing to do, so reset some values.
    if (!state.repositioning && !state.resizing) {
      state.resizingCoords.x = null;
      state.resizingCoords.y = null;
      return;
    }

    this.clearCanvas();

    if (state.repositioning) {
      return this.repositionMarquee(e);
    } else if (state.resizing) {
      return this.resizeMarquee(e);
    }
  };

  CanvasCrop.prototype.repositionMarquee = function(e) {
    var mouse = this.getMouse(e),
        state = this.state,
        dimensions = this.getScaledDimensions(),
        marquee = this.marquee,
        x, y;

    // The marquee begins at the cursor minus the initial click offset.
    x = mouse.x - state.repositioningOffset.x;
    y = mouse.y - state.repositioningOffset.y;

    // Ensure that the marquee cannot move beyond the image dimension bounds;
    x = Math.min(Math.max(x, dimensions.x), dimensions.x2 - marquee.w);
    y = Math.min(Math.max(y, dimensions.y), dimensions.y2 - marquee.h);

    this.drawMarquee(x, y, marquee.w, marquee.h);

    this.$canvas.trigger($.Event('crop.reposition', {coordinates: this.getCropCoordinates(true)}));
  };

  CanvasCrop.prototype.resizeMarquee = function(e) {
    var mouse = this.getMouse(e),
        state = this.state,
        dimensions = this.getScaledDimensions(),
        x, y, w, h;

    // Save these values that are used to calculate offets during resizing and dragging.
    if (!state.resizingCoords.x || !state.resizingCoords.y) {
      state.resizingCoords = mouse;
      state.repositioningCoords = mouse;
    }

    // Ensure that the marquee cannot start outside of the scaled image area and
    // cannot be dragged outside of the scaled image area.

    x = Math.min(Math.max(state.resizingCoords.x, dimensions.x), dimensions.x2);
    y = Math.min(Math.max(state.resizingCoords.y, dimensions.y), dimensions.y2);

    if (mouse.x < x) {
      w = Math.max(mouse.x - x, dimensions.x - x);
    } else {
      w = Math.min(Math.max(mouse.x - x, 0), dimensions.x2 - x);
    }

    if (mouse.y < y) {
      h = Math.max(mouse.y - y, dimensions.y - y);
    } else {
      h = Math.min(Math.max(mouse.y - y, 0), dimensions.y2 - y);
    }

    // Constrain aspect ratio if shift key is pressed or we're constraining.
    if (this.options.constrain || this.state.shiftKey) {
      var min = Math.min(Math.abs(w), Math.abs(h));
      h = h < 0 ? -min : min;
      w = w < 0 ? -min : min;
    }

    this.drawMarquee(x, y, w, h);
    this.$canvas.trigger($.Event('crop.resize', {coordinates: this.getCropCoordinates(true)}));
  };

  CanvasCrop.prototype.drawMarquee = function(x, y, w, h) {
    var marquee;

    switch (this.options.marqueeType) {
      case 'rectangle':
        marquee = new Rectangle(x, y, w, h);
        break;

      case 'ellipse':
        marquee = new Ellipse(x, y, w, h);
        break;

      default:
        return;
    }

    marquee.draw(this.context);
    this.marquee = marquee;
  };

  /**
   * Gets the scaled cropped coordinates of the image from the marquee. Optionally return Math.floor'ed values.
   *
   * @returns {{x: number, y: number, w: number, h: number}}
   */
  CanvasCrop.prototype.getCropCoordinates = function(floor) {
    var factor = this.getScalingFactor(),
        dimensions,
        packed;

    if (!this.marquee) return null;

    // The image will be centered in the canvas, so take the x and y offset into account.
    dimensions = this.getScaledDimensions();

    // The x/y offset will be >= 0.
    packed = {
      x: (this.marquee.x - dimensions.x) / factor,
      y: (this.marquee.y - dimensions.y) / factor,
      w: this.marquee.w / factor,
      h: this.marquee.h / factor
    };

    // Normalize the values.
    if (floor) {
      for (var i in packed) {
        if (packed.hasOwnProperty(i)) {
          packed[i] = Math.floor(packed[i]);
        }
      }
    }

    return packed;
  };

  /**
   * Loads the image and draws it.
   */
  CanvasCrop.prototype.drawBackground = function() {
    if (this.options.src && !this.image) {
      this.image = document.createElement('img');
      this.image.src = this.options.src;
      $(this.image).on('load', this.drawImage.bind(this));
    } else {
      this.drawImage();
    }
  };

  /**
   * Draws the image onto the canvas.
   */
  CanvasCrop.prototype.drawImage = function() {
    var dimensions = this.getScaledDimensions();
    this.context.drawImage(this.image, dimensions.x, dimensions.y, dimensions.w, dimensions.h);
  };

  /**
   * Clears and redraws the base background.
   */
  CanvasCrop.prototype.clearCanvas = function() {
    this.context.clearRect(0, 0, this.getCanvasWidth(), this.getCanvasHeight());
    this.drawBackground();
  };

  /**
   * Returns the coordinates used to fit an image into the canvas. Centers and scales down if necessary.
   *
   * @returns {{x: number, y: number, x2: number, y2: number, w: number, h: number}}
   */
  CanvasCrop.prototype.getScaledDimensions = function() {
    var factor = this.getScalingFactor(),
        w = this.image.width * factor,
        h = this.image.height * factor,
        x = (this.getCanvasWidth() - w) / 2,
        y = (this.getCanvasHeight() - h) / 2;

    return {
      x: x,
      y: y,
      x2: x + w,
      y2: y + h,
      w: w,
      h: h
    };
  };

  /**
   * Returns the image scaling factor that is not greater than 1x.
   * @returns {number}
   */
  CanvasCrop.prototype.getScalingFactor = function() {
    var xScale = this.getCanvasWidth() / this.image.width,
        yScale = this.getCanvasHeight() / this.image.height;

    return Math.min(Math.min(xScale, yScale), 1);
  };

  CanvasCrop.prototype.getCanvasWidth = function() {
    return this.canvas.width;
  };

  CanvasCrop.prototype.getCanvasHeight = function() {
    return this.canvas.height;
  };

  /**
   * Gets the mouse coordinates relative to the canvas. The event properties pageX and pageY give us the position
   * of the mouse relative to the left and top edge of the document. We then subtract the canvas offset relative
   * to the same corner as well as padding and border to get the "true" coordinates relative to the canvas.
   */
  CanvasCrop.prototype.getMouse = function(e) {
    var tgt = e.target,
        offset = $(tgt).offset();

    return {
      x: e.pageX - offset.left - this.state.canvas.paddingLeft - this.state.canvas.borderLeft,
      y: e.pageY - offset.top - this.state.canvas.paddingTop - this.state.canvas.borderTop
    };
  };

  /**
   * When called, writes the selected portion of the image to a hidden canvas and exports its data.
   * This is a very slow function and should only be called on mouseup, and only if the user enabled the feature.
   */
  CanvasCrop.prototype.getRawCroppedImageData = function() {
    var workCanvas = document.createElement('canvas'),
        workContext = workCanvas.getContext('2d'),
        coords = this.getCropCoordinates(true),
        packed;

    // The data array to return
    packed = {
      x: coords.x,
      y: coords.y,
      w: coords.w,
      h: coords.h,
      image: {
        w: this.image.width,
        h: this.image.height
      }
    };

    // Set the canvas dimensions in order to crop properly.
    workCanvas.width = coords.w;
    workCanvas.height = coords.h;

    // Draw the selected image into the canvas.
    workContext.drawImage(this.image, coords.x, coords.y, coords.w, coords.h, 0, 0, coords.w, coords.h);

    // If the image isn't being served off of the same domain, this will throw a security exception.
    // Let's catch that exception and instead just set data to null.
    try {
      packed.data = workCanvas.toDataURL('image/png');
    } catch(e) {
      packed.data = null;
      packed.exception = e;
    }

    return packed;
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} fill
   * @constructor
   */
  Shape = function(x, y, w, h, fill) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.fill = fill || 'rgba(0, 255, 255, .3)';
    this.normalize();
  };

  /**
   * If the shape is drawn from a lower to upper quadrant, width and/or height will be negative.
   * Normalizing to positive numbers makes working with coordinates easier.
   */
  Shape.prototype.normalize = function() {
    this.x = this.w < 0 ? this.x + this.w : this.x;
    this.y = this.h < 0 ? this.y + this.h : this.y;
    this.w = Math.abs(this.w);
    this.h = Math.abs(this.h);
  };

  Shape.prototype.draw = function() {
    throw 'Method "draw" must be implemented on objects inheriting from Shape.';
  };

  Shape.prototype.contains = function() {
    throw 'Method "contains" must be implemented on objects inheriting from Shape.';
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} fill
   * @constructor
   */
  Rectangle = function(x, y, w, h, fill) {
    Shape.call(this, x, y, w, h, fill);
  };

  $.extend(Rectangle.prototype, Shape.prototype);

  Rectangle.prototype.draw = function(context) {
    context.fillStyle = this.fill;
    context.fillRect(this.x, this.y, this.w, this.h);
  };

  /**
   * Determine if a point is inside the shape's bounds.
   *
   * @param mx
   * @param my
   * @returns {boolean}
   */
  Rectangle.prototype.contains = function(mx, my) {
    return (this.x <= mx) && (this.x + this.w >= mx) && (this.y <= my) && (this.y + this.h >= my);
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} fill
   * @constructor
   */
  Ellipse = function(x, y, w, h, fill) {
    Shape.call(this, x, y, w, h, fill);
    this.kappa = 0.5522848;
    this.ox = (this.w / 2) * this.kappa; // control point offset horizontal
    this.oy = (this.h / 2) * this.kappa; // control point offset vertical
    this.xe = this.x + this.w; // x-end
    this.ye = this.y + this.h; // y-end
    this.xm = this.x + this.w / 2; // x-middle
    this.ym = this.y + this.h / 2; // y-middle
    this.xr = this.w / 2; // x-radius
    this.yr = this.h / 2; // y-radius
  };

  $.extend(Ellipse.prototype, Shape.prototype);

  /**
   * http://math.stackexchange.com/a/76463
   *
   * @param {number} mx
   * @param {number} my
   * @returns {boolean}
   */
  Ellipse.prototype.contains = function(mx, my) {
    return (Math.pow(mx - this.xm, 2) / Math.pow(this.xr, 2)) +
        (Math.pow(my - this.ym, 2) / Math.pow(this.yr, 2)) <= 1;
  };

  /**
   * Draws an ellipse using Bezier curves. See http://stackoverflow.com/a/2173084/2651279
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  Ellipse.prototype.draw = function(ctx) {
    var x = this.x,
        y = this.y,
        ox = this.ox,
        oy = this.oy,
        xe = this.xe,
        ye = this.ye,
        xm = this.xm,
        ym = this.ym;

    ctx.beginPath();
    ctx.moveTo(x, ym);
    ctx.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
    ctx.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
    ctx.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
    ctx.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
    ctx.closePath();
    ctx.fillStyle = this.fill;
    ctx.fill();
  };

  /**
   * jQuery plugin definition
   *
   * @param {object} option
   * @returns {*}
   */
  $.fn.canvasCrop = function(option) {
    return this.each(function() {
      var $this   = $(this),
          data    = $this.data('canvas-crop'),
          options = $.extend({}, CanvasCrop.DEFAULTS, $this.data(), typeof option == 'object' && option);

      if (!data) $this.data('canvas-crop', (data = new CanvasCrop(this, options)));
    });
  };

  $.fn.canvasCrop.Constructor = CanvasCrop;
}));