import { Component, Input, computed, inject, ElementRef, ViewChild, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartStateService } from '../../services/chart-state.service';

@Component({
  selector: 'app-minimap',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './minimap.component.html',
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class MinimapComponent {
  chartState = inject(ChartStateService);
  
  @ViewChild('minimapContainer') minimapContainer!: ElementRef<HTMLDivElement>;

  @Input() containerWidth = 0;
  @Input() containerHeight = 0;

  width = 240;
  height = 160;
  padding = 40; // Padding in world units

  // Determine the bounding box of the entire chart content
  bounds = computed(() => {
    const positions = this.chartState.nodePositions();
    const drawings = this.chartState.drawings();
    
    if (positions.size === 0 && drawings.length === 0) {
      // Default bounds if empty
      return { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Check Nodes
    positions.forEach(pos => {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      const w = pos.width || 208;
      const h = pos.height || 100;
      if (pos.x + w > maxX) maxX = pos.x + w;
      if (pos.y + h > maxY) maxY = pos.y + h;
    });

    // Check Drawings
    drawings.forEach(d => {
        // Extract numbers from path "M 10 20 L 30 40"
        const coords = d.path.match(/[-+]?[0-9]*\.?[0-9]+/g);
        if (coords) {
            for (let i = 0; i < coords.length; i += 2) {
                const x = parseFloat(coords[i]);
                const y = parseFloat(coords[i+1]);
                if (!isNaN(x)) {
                   if (x < minX) minX = x;
                   if (x > maxX) maxX = x;
                }
                if (!isNaN(y)) {
                   if (y < minY) minY = y;
                   if (y > maxY) maxY = y;
                }
            }
        }
    });
    
    // Safety check if we found nothing valid
    if (minX === Infinity) {
        minX = 0; minY = 0; maxX = 1000; maxY = 1000;
    }

    // Add padding to bounds
    minX -= this.padding;
    minY -= this.padding;
    maxX += this.padding;
    maxY += this.padding;

    const w = maxX - minX;
    const h = maxY - minY;

    // Ensure non-zero dimensions
    return { minX, minY, maxX, maxY, width: Math.max(w, 100), height: Math.max(h, 100) };
  });

  // Calculate the scaling factor to fit World Bounds into Minimap Dimensions
  scale = computed(() => {
    const b = this.bounds();
    const scaleX = this.width / b.width;
    const scaleY = this.height / b.height;
    // Fit containment
    return Math.min(scaleX, scaleY);
  });

  // Transform ChartNodes into Minimap Rects
  miniNodes = computed(() => {
    const nodes = this.chartState.nodes();
    const positions = this.chartState.nodePositions();
    const b = this.bounds();
    const s = this.scale();
    
    // Center the content in the minimap if aspect ratios differ
    const offsetX = (this.width - (b.width * s)) / 2;
    const offsetY = (this.height - (b.height * s)) / 2;

    const result: {id: string, x: number, y: number, w: number, h: number, color: string}[] = [];

    positions.forEach((pos, id) => {
      const node = nodes.get(id);
      if (!node) return;

      // Transform World -> Minimap
      const x = (pos.x - b.minX) * s + offsetX;
      const y = (pos.y - b.minY) * s + offsetY;
      const w = (pos.width || 208) * s;
      const h = (pos.height || 100) * s;
      
      let color = '#cbd5e1'; // Default gray
      if (node.type === 'executive' || node.type === 'manager') color = '#93c5fd'; // blue-300
      if (node.type === 'group') color = '#f1f5f9'; // slate-100
      if (node.type === 'note') color = '#fcd34d'; // amber-300
      if (node.backgroundColor && node.backgroundColor !== '#ffffff' && node.backgroundColor !== 'transparent') {
          color = node.backgroundColor;
      }

      result.push({ id, x, y, w, h, color });
    });

    return result;
  });

  miniDrawings = computed(() => {
      const drawings = this.chartState.drawings();
      const b = this.bounds();
      const s = this.scale();
      
      const offsetX = (this.width - (b.width * s)) / 2;
      const offsetY = (this.height - (b.height * s)) / 2;

      const transformCoord = (val: number, isX: boolean): number => {
          const transformed = isX
              ? (val - b.minX) * s + offsetX
              : (val - b.minY) * s + offsetY;
          return Math.round(transformed * 100) / 100;
      };
      
      return drawings.map(d => {
          const commandRegex = /([a-zA-Z])([^a-zA-Z]*)/g;
          let transformedPath = "";
          let match;
          const pathString = d.path || '';

          while ((match = commandRegex.exec(pathString)) !== null) {
              const command = match[1];
              const params = match[2].trim();
              
              transformedPath += command + ' ';

              if (params) {
                  const coords = params.split(/[ ,]+/).filter(Boolean);
                  
                  const newCoords = coords.map((coord, index) => {
                      const val = parseFloat(coord);
                      if (isNaN(val)) return '';
                      
                      const isX = index % 2 === 0;
                      return transformCoord(val, isX).toString();
                  });

                  transformedPath += newCoords.join(' ') + ' ';
              }
          }

          return {
              id: d.id,
              path: transformedPath.trim(),
              color: d.color
          };
      });
  });

  // Calculate the Viewport Indicator Rectangle
  viewport = computed(() => {
    const zoom = this.chartState.zoomLevel() / 100;
    const pan = this.chartState.panOffset();
    const b = this.bounds();
    const s = this.scale();

    // Center offsets
    const mapOffsetX = (this.width - (b.width * s)) / 2;
    const mapOffsetY = (this.height - (b.height * s)) / 2;

    // The visible area in World Coordinates
    // Pan offset moves the canvas, so visible area is opposite to pan
    const visibleWorldX = -pan.x / zoom;
    const visibleWorldY = -pan.y / zoom;
    const visibleWorldW = this.containerWidth / zoom;
    const visibleWorldH = this.containerHeight / zoom;

    // Map to Minimap Coords
    const x = (visibleWorldX - b.minX) * s + mapOffsetX;
    const y = (visibleWorldY - b.minY) * s + mapOffsetY;
    const w = visibleWorldW * s;
    const h = visibleWorldH * s;

    return { x, y, w, h };
  });

  // Interaction: Drag or Click to Pan
  onMouseDown(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    this.updatePosition(event);

    const onMouseMove = (e: MouseEvent | TouchEvent) => {
        e.preventDefault();
        this.updatePosition(e);
    };

    const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onMouseMove);
        window.removeEventListener('touchend', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onMouseMove, { passive: false });
    window.addEventListener('touchend', onMouseUp);
  }

  private updatePosition(event: MouseEvent | TouchEvent) {
    if (!this.minimapContainer) return;

    const rect = this.minimapContainer.nativeElement.getBoundingClientRect();
    if (!rect) return;
    
    const pointer = 'touches' in event ? event.touches[0] : event;

    const clickX = pointer.clientX - rect.left;
    const clickY = pointer.clientY - rect.top;

    const b = this.bounds();
    const s = this.scale();
    const zoom = this.chartState.zoomLevel() / 100;

    const mapOffsetX = (this.width - (b.width * s)) / 2;
    const mapOffsetY = (this.height - (b.height * s)) / 2;

    // Reverse Transform: Minimap -> World
    const targetWorldX = ((clickX - mapOffsetX) / s) + b.minX;
    const targetWorldY = ((clickY - mapOffsetY) / s) + b.minY;

    // We want to center the viewport on this world position
    const newPanX = -(targetWorldX * zoom) + (this.containerWidth / 2);
    const newPanY = -(targetWorldY * zoom) + (this.containerHeight / 2);

    this.chartState.panOffset.set({ x: newPanX, y: newPanY });
  }
}