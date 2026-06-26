/**
 * Utility functions for applying watermarks to images
 */

export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

/**
 * Load an image from URL and return as HTMLImageElement
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Get CSS position classes based on watermark position
 */
export function getPositionClasses(position: WatermarkPosition): string {
  switch (position) {
    case 'top-left':
      return 'top-2 left-2 md:top-4 md:left-4';
    case 'top-right':
      return 'top-2 right-2 md:top-4 md:right-4';
    case 'bottom-left':
      return 'bottom-2 left-2 md:bottom-4 md:left-4';
    case 'center':
      return 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2';
    case 'bottom-right':
    default:
      return 'bottom-2 right-2 md:bottom-4 md:right-4';
  }
}

/**
 * Download an image with watermark applied using Canvas API
 * Uses a tiled/repeated pattern for better copyright protection
 */
export async function downloadWithWatermark(
  imageUrl: string,
  watermarkUrl: string,
  opacity: number,
  filename: string,
  watermarkSize: number = 80
): Promise<void> {
  try {
    // Load both images
    const [image, watermark] = await Promise.all([
      loadImage(imageUrl),
      loadImage(watermarkUrl),
    ]);

    // Create canvas with image dimensions
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;

    // Draw the main image
    ctx.drawImage(image, 0, 0);

    // Calculate watermark dimensions based on size setting
    // Size is treated as a percentage of the smaller image dimension
    const minDimension = Math.min(image.width, image.height);
    const watermarkHeight = minDimension * (watermarkSize / 800); // Smaller size for tiles
    const watermarkWidth = (watermark.width / watermark.height) * watermarkHeight;

    // Apply opacity
    ctx.globalAlpha = opacity / 100;

    // Create a tiled pattern across the image
    // Calculate spacing for a nice grid pattern
    const spacingX = watermarkWidth * 2.5;
    const spacingY = watermarkHeight * 2.5;

    // Offset rows for a diagonal pattern effect
    let rowIndex = 0;
    for (let y = watermarkHeight; y < image.height - watermarkHeight/2; y += spacingY) {
      const xOffset = rowIndex % 2 === 0 ? 0 : spacingX / 2;
      for (let x = xOffset + watermarkWidth/2; x < image.width - watermarkWidth/2; x += spacingX) {
        // Rotate slightly for visual interest
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-25 * Math.PI / 180); // -25 degree rotation
        ctx.drawImage(watermark, -watermarkWidth/2, -watermarkHeight/2, watermarkWidth, watermarkHeight);
        ctx.restore();
      }
      rowIndex++;
    }

    // Convert to blob and download
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      'image/jpeg',
      0.92
    );
  } catch (error) {
    console.error('Error downloading image with watermark:', error);
    // Fallback: download without watermark
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
