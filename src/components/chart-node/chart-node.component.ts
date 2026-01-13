import { Component, Input, Output, EventEmitter, ElementRef, AfterViewInit, OnDestroy, HostListener, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartNode } from '../../services/chart-state.service';

@Component({
  selector: 'app-chart-node',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-node.component.html',
  styles: [`
    :host {
      display: block;
      position: absolute; 
    }
    textarea {
        cursor: text;
    }
    .resize-handle {
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: rotate(45deg);
    }
  `]
})
export class ChartNodeComponent {
  @Input({ required: true }) node!: ChartNode;
  @Input() isSelected = false;
  @Input() nodeWidth?: number;
  @Input() nodeHeight?: number;

  @Output() nodeDown = new EventEmitter<MouseEvent | TouchEvent>();
  @Output() linkStart = new EventEmitter<MouseEvent | TouchEvent>();
  @Output() dimensionsChange = new EventEmitter<{w: number, h: number}>();
  @Output() textChange = new EventEmitter<string>();
  
  @ViewChild('textInput') textInput?: ElementRef<HTMLTextAreaElement>;
  isEditing = false;

  private isResizing = false;
  private resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  // Logic to determine shape geometry
  getBorderRadius(): number {
    if (this.node.shapeType === 'circle') return 9999;
    return this.node.borderRadius || 0;
  }

  getClipPath(): string | null {
    switch (this.node.shapeType) {
      case 'triangle':
        return 'polygon(50% 0%, 0% 100%, 100% 100%)';
      case 'diamond':
        return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      case 'star':
        return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
      default:
        return null;
    }
  }

  hasBorder(): boolean {
    return !['triangle', 'diamond', 'star'].includes(this.node.shapeType || 'rectangle');
  }

  isMaterialIcon(str?: string): boolean {
    if (!str) return true;
    return /^[a-z0-9_]+$/.test(str);
  }
  
  enterEditMode(event: MouseEvent) {
    event.stopPropagation();
    this.isEditing = true;
    setTimeout(() => {
      this.textInput?.nativeElement.focus();
      this.textInput?.nativeElement.select();
    }, 0);
  }

  onMouseDown(event: MouseEvent | TouchEvent) {
    if (!('button' in event) || ('button' in event && event.button === 0)) {
      this.nodeDown.emit(event);
    }
  }

  onLinkMouseDown(event: MouseEvent | TouchEvent) {
    event.stopPropagation();
    event.preventDefault();
    if (!('button' in event) || ('button' in event && event.button === 0)) {
      this.linkStart.emit(event);
    }
  }
  
  onNoteInput(event: Event) {
      const val = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
      this.textChange.emit(val);
  }

  // --- Resize Logic ---

  onResizeDown(event: MouseEvent | TouchEvent) {
      event.preventDefault();
      event.stopPropagation(); // Critical: Prevents the parent 'drag' logic from firing
      this.isResizing = true;

      const pointer = 'touches' in event ? event.touches[0] : event;

      this.resizeStart = {
          x: pointer.clientX,
          y: pointer.clientY,
          w: this.nodeWidth || (this.node.type === 'note' ? 200 : (this.node.type === 'text' ? 150 : 150)),
          h: this.nodeHeight || (this.node.type === 'note' ? 200 : (this.node.type === 'text' ? 50 : 150))
      };
      
      // Add global listeners
      window.addEventListener('mousemove', this.onResizeMove);
      window.addEventListener('mouseup', this.onResizeUp);
      window.addEventListener('touchmove', this.onResizeMove, { passive: false });
      window.addEventListener('touchend', this.onResizeUp);
  }

  private onResizeMove = (event: MouseEvent | TouchEvent) => {
      if (!this.isResizing) return;
      
      // Prevent page scroll on touch devices
      if ('touches' in event) {
        event.preventDefault();
      }

      const pointer = 'touches' in event ? event.touches[0] : event;
      
      const dx = pointer.clientX - this.resizeStart.x;
      const dy = pointer.clientY - this.resizeStart.y;
      
      // Calculate new dimensions (with min size limits)
      const scale = 1; // Assuming 1:1 for simplicity, or we could pass zoom level if needed
      const newW = Math.max(50, this.resizeStart.w + dx);
      const newH = Math.max(30, this.resizeStart.h + dy); // Lower limit for text
      
      this.dimensionsChange.emit({ w: newW, h: newH });
  }

  private onResizeUp = () => {
      this.isResizing = false;
      window.removeEventListener('mousemove', this.onResizeMove);
      window.removeEventListener('mouseup', this.onResizeUp);
      window.removeEventListener('touchmove', this.onResizeMove);
      window.removeEventListener('touchend', this.onResizeUp);
  }
}
