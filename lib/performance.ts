
export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 's';
  timestamp: number;
}

class PerformanceTracker {
  private metrics: PerformanceMetric[] = [];
  private static instance: PerformanceTracker;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.initWebVitals();
    }
  }

  public static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  private initWebVitals() {
    // TTFB
    window.addEventListener('load', () => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      if (navigation) {
        this.addMetric('TTFB', navigation.responseStart, 'ms');
      }
    });

    // FCP
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          this.addMetric('FCP', entry.startTime, 'ms');
        }
      }
    });
    observer.observe({ type: 'paint', buffered: true });
  }

  public addMetric(name: string, value: number, unit: 'ms' | 's' = 'ms') {
    this.metrics.push({
      name,
      value: Math.round(value * 100) / 100,
      unit,
      timestamp: Date.now()
    });
    console.log(`[Performance] ${name}: ${value}${unit}`);

    // Dispatch custom event for the UI to update
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('performance-metric-added', { detail: name }));
    }
  }

  public getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  public async trackTimed<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const end = performance.now();
      this.addMetric(name, end - start, 'ms');
    }
  }
}

export const performanceTracker = PerformanceTracker.getInstance();
