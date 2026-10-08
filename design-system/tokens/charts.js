/**
 * Chart tokens that are not CSS.
 *
 * A chart's design is only partly colors and lengths — those are in charts.css
 * and resolve per mode. What is here are the DECISIONS a charting library takes
 * as arguments: how many ticks to aim for, what curve joins the points, whether
 * a scale is a band or a time, how much of a band is gap rather than bar.
 *
 * `bandPaddingInner` is worth pointing at. Bar width and spacing are not bar
 * properties — a bar gets whatever its band axis leaves it — which is why they
 * are here on the axis and not on the mark.
 *
 * Generated from the .ds file. Do not edit; regenerate.
 */


/** The categorical palette, in scale order. Series N takes palette[N - 1]. */
export const chartPalette = [
  "oklch(22.00% 0 0deg)",
  "oklch(31.50% 0 0deg)",
  "oklch(41.00% 0 0deg)",
  "oklch(50.50% 0 0deg)",
  "oklch(60.00% 0 0deg)",
  "oklch(69.50% 0 0deg)",
  "oklch(79.00% 0 0deg)",
  "oklch(88.50% 0 0deg)"
];


/** Every chart type this system defines. */
export const chartTypes = {
  "bar": {
    "family": "cartesian",
    "mark": "bar",
    "orientation": "vertical",
    "categoryAxis": {
      "name": "category",
      "scale": "band",
      "nice": true,
      "zero": true,
      "gridLines": false,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "valueAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "stackOffset": "none",
    "groupPadding": 0.08,
    "legend": {
      "placement": "top",
      "align": "start",
      "symbol": "circle"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "line": {
    "family": "cartesian",
    "mark": "line",
    "orientation": "vertical",
    "categoryAxis": {
      "name": "time",
      "scale": "time",
      "nice": false,
      "zero": true,
      "gridLines": false,
      "bandPaddingInner": 0,
      "bandPaddingOuter": 0,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "valueAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "curve": "monotone_x",
    "legend": {
      "placement": "top",
      "align": "start",
      "symbol": "circle"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "area": {
    "family": "cartesian",
    "mark": "area",
    "orientation": "vertical",
    "categoryAxis": {
      "name": "time",
      "scale": "time",
      "nice": false,
      "zero": true,
      "gridLines": false,
      "bandPaddingInner": 0,
      "bandPaddingOuter": 0,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "valueAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "curve": "monotone_x",
    "legend": {
      "placement": "top",
      "align": "start",
      "symbol": "circle"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "scatter": {
    "family": "cartesian",
    "mark": "point",
    "orientation": "vertical",
    "categoryAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "valueAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "legend": {
      "placement": "top",
      "align": "start",
      "symbol": "circle"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "donut": {
    "family": "radial",
    "mark": "wedge",
    "innerRadiusRatio": 0.6,
    "padAngle": 0.015,
    "legend": {
      "placement": "right",
      "align": "start",
      "symbol": "square"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "sparkline": {
    "family": "cartesian",
    "mark": "line",
    "orientation": "vertical",
    "categoryAxis": null,
    "valueAxis": null,
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "curve": "monotone_x",
    "legend": null,
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  }
};


/** Arrangements of those types — stacked, grouped, horizontal — keyed `type.style`. */
export const chartStyles = {
  "bar.grouped": {
    "family": "cartesian",
    "mark": "bar",
    "orientation": "vertical",
    "categoryAxis": {
      "name": "category",
      "scale": "band",
      "nice": true,
      "zero": true,
      "gridLines": false,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "valueAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "stackOffset": "none",
    "groupPadding": 0.08,
    "legend": {
      "placement": "top",
      "align": "start",
      "symbol": "circle"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "bar.stacked": {
    "family": "cartesian",
    "mark": "bar",
    "orientation": "vertical",
    "categoryAxis": {
      "name": "category",
      "scale": "band",
      "nice": true,
      "zero": true,
      "gridLines": false,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "valueAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "stackOffset": "none",
    "groupPadding": 0.08,
    "legend": {
      "placement": "top",
      "align": "start",
      "symbol": "circle"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "bar.stacked_100": {
    "family": "cartesian",
    "mark": "bar",
    "orientation": "vertical",
    "categoryAxis": {
      "name": "category",
      "scale": "band",
      "nice": true,
      "zero": true,
      "gridLines": false,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "valueAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "stackOffset": "expand",
    "groupPadding": 0.08,
    "legend": {
      "placement": "top",
      "align": "start",
      "symbol": "circle"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "bar.horizontal": {
    "family": "cartesian",
    "mark": "bar",
    "orientation": "horizontal",
    "categoryAxis": {
      "name": "category",
      "scale": "band",
      "nice": true,
      "zero": true,
      "gridLines": false,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "valueAxis": {
      "name": "value",
      "scale": "linear",
      "nice": true,
      "zero": true,
      "gridLines": true,
      "bandPaddingInner": 0.2,
      "bandPaddingOuter": 0.1,
      "tickOverflow": "thin",
      "dateStyle": "abbreviated",
      "numberStyle": "plain",
      "numberDecimals": 0
    },
    "xAxisSide": "bottom",
    "yAxisSide": "left",
    "stackOffset": "none",
    "groupPadding": 0.08,
    "legend": {
      "placement": "top",
      "align": "start",
      "symbol": "circle"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  },
  "donut.pie": {
    "family": "radial",
    "mark": "wedge",
    "innerRadiusRatio": 0,
    "padAngle": 0.015,
    "legend": {
      "placement": "right",
      "align": "start",
      "symbol": "square"
    },
    "sizes": {
      "medium": {
        "plotHeight": 48,
        "tickCount": 5,
        "markSize": 6
      },
      "large": {
        "plotHeight": 48,
        "tickCount": 8,
        "markSize": 8
      }
    }
  }
};
