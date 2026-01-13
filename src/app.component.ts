import { Component, inject, signal, computed, ElementRef, ViewChild, HostListener, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartStateService, NodePosition } from './services/chart-state.service';
import { ChartNodeComponent } from './components/chart-node/chart-node.component';
import { MinimapComponent } from './components/minimap/minimap.component';

type ToolMode = 'select' | 'hand' | 'note' | 'shape' | 'pen' | 'group' | 'text' | 'eraser';
type ShapeType = 'rectangle' | 'circle' | 'triangle' | 'star' | 'diamond';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ChartNodeComponent, MinimapComponent],
  templateUrl: './app.component.html',
  host: {
    '(window:keydown)': 'onKeyDown($event)',
    '(window:keyup)': 'onKeyUp($event)',
    '(document:click)': 'onDocumentClick($event)',
  }
})
export class AppComponent implements AfterViewInit, OnDestroy {
  chartState = inject(ChartStateService);
  
  @ViewChild('mainContainer') mainContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasContent') canvasContent!: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('exportButtonContainer') exportButtonContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('jsonImportInput') jsonImportInput!: ElementRef<HTMLInputElement>;
  
  // Sidebar visibility state
  isLeftSidebarOpen = signal(window.innerWidth >= 1024);
  isRightSidebarOpen = signal(window.innerWidth >= 1024);

  currentType = signal('functional');
  activeTool = signal<ToolMode>('select');
  toolColor = signal<string>('#fef3c7'); // Default yellow note
  
  // Export Menu State
  isExportMenuOpen = signal(false);
  isExporting = signal(false);

  // Shortcuts Modal State
  showShortcutsModal = signal(false);
  
  // Canvas Dimensions for Minimap
  canvasWidth = signal(0);
  canvasHeight = signal(0);
  private resizeObserver: ResizeObserver | null = null;

  // --- Strict Rainbow Palette ---
  rainbowColors = [
    { name: 'Red', value: '#ef4444' },    // Red
    { name: 'Orange', value: '#f97316' }, // Orange
    { name: 'Yellow', value: '#eab308' }, // Yellow
    { name: 'Green', value: '#22c55e' },  // Green
    { name: 'Blue', value: '#3b82f6' },   // Blue
    { name: 'Indigo', value: '#6366f1' }, // Indigo
    { name: 'Violet', value: '#a855f7' }, // Violet
    { name: 'Black', value: '#000000' },
    { name: 'White', value: '#ffffff' },
  ];

  pastelColors = [
    { name: 'Pastel Red', value: '#fecaca' },
    { name: 'Pastel Orange', value: '#fed7aa' },
    { name: 'Pastel Yellow', value: '#fef3c7' },
    { name: 'Pastel Green', value: '#bbf7d0' },
    { name: 'Pastel Blue', value: '#bfdbfe' },
    { name: 'Pastel Indigo', value: '#c7d2fe' },
    { name: 'Pastel Violet', value: '#e9d5ff' },
    { name: 'Pastel Black', value: '#94a3b8' },
    { name: 'Cloud Dancer', value: '#F0EEE9' },
  ];

  neonColors = [
    { name: 'Neon Red', value: '#ff0033' },
    { name: 'Neon Orange', value: '#ff6600' },
    { name: 'Neon Yellow', value: '#efff00' },
    { name: 'Neon Green', value: '#33ff00' },
    { name: 'Neon Cyan', value: '#00ffff' },
    { name: 'Neon Blue', value: '#0066ff' },
    { name: 'Neon Purple', value: '#cc00ff' },
    { name: 'Neon Pink', value: '#ff0099' },
  ];

  // Available Shape Types for the Shape Tool
  availableShapes: {id: ShapeType, icon: string, label: string}[] = [
    { id: 'rectangle', icon: 'crop_square', label: 'Rectángulo' },
    { id: 'circle', icon: 'circle', label: 'Círculo' },
    { id: 'triangle', icon: 'change_history', label: 'Triángulo' },
    { id: 'diamond', icon: 'diamond', label: 'Diamante' },
    { id: 'star', icon: 'star_border', label: 'Estrella' },
  ];
  
  // Selected default shape for the tool
  selectedShapeType = signal<ShapeType>('rectangle');
  
  // Interaction Modes
  isSpacePressed = false;
  isPanning = false;
  
  // Drawing State
  isDrawing = false;
  currentPoints: {x: number, y: number}[] = [];
  currentPathString = '';

  // Rubberband Selection State
  isSelecting = false;
  selectionStart = { x: 0, y: 0 };
  selectionBox: { left: number, top: number, width: number, height: number } | null = null;
  
  // Group creation state (drag to create)
  isCreatingGroup = false;

  // Node Drag State
  isDraggingNode = false;
  dragNodeId: string | null = null;
  dragStartOffset = { x: 0, y: 0 };
  
  // Drawing Drag State
  isDraggingDrawing = false;

  // Linking State
  isLinking = false;
  linkSourceId: string | null = null;
  linkStartPos: NodePosition | null = null;
  linkCurrentPos: NodePosition | null = null;
  
  // Mouse Tracking for Paste Logic
  lastMouseWorldPos: { x: number, y: number } | null = null;
  isMouseOverCanvas = false;

  // Touch Interaction State
  private lastPinchDistance: number | null = null;
  private isPinching = false;


  chartTypes = [
    { id: 'whiteboard', name: 'Pizarrón', icon: 'gesture' },
    { id: 'functional', name: 'Organigrama', icon: 'account_tree' }
  ];
  
  levels = [
    'P0 - Egresado',
    'P1 - Seguir',
    'P2 - Asistir',
    'P3 - Aplicar',
    'P4 - Facilitar',
    'P5 - Asegurar, Asesorar',
    'P6 - Iniciar, Ejercer influencia',
    'P7 - Establecer estrategias, inspirar, movilizar'
  ];
  
  // Shortcuts Data Structure
  shortcutsList = [
    {
      category: 'General',
      items: [
        { key: 'Espacio + Arrastrar', desc: 'Mover el Lienzo' },
        { key: 'Rueda del Ratón', desc: 'Mover Verticalmente' },
        { key: 'Ctrl + Rueda', desc: 'Aumentar/Reducir Zoom' },
        { key: 'Ctrl + A', desc: 'Seleccionar Todo' }
      ]
    },
    {
      category: 'Edición',
      items: [
        { key: 'Clic', desc: 'Seleccionar Nodo' },
        { key: 'Shift + Clic', desc: 'Selección Múltiple' },
        { key: 'Arrastrar', desc: 'Mover / Seleccionar Área' },
        { key: 'Supr', desc: 'Eliminar Selección' }
      ]
    },
    {
      category: 'Portapapeles',
      items: [
        { key: 'Ctrl + C', desc: 'Copiar Selección' },
        { key: 'Ctrl + X', desc: 'Cortar Selección' },
        { key: 'Ctrl + V', desc: 'Pegar Selección' }
      ]
    },
    {
      category: 'Historial',
      items: [
        { key: 'Ctrl + Z', desc: 'Deshacer' },
        { key: 'Ctrl + Y', desc: 'Rehacer' }
      ]
    }
  ];

  // Comprehensive Emoji Categories
  emojiCategories = [
    {
      name: 'Personas y Roles',
      emojis: [
        '👤', '👥', '🗣️', '🧑‍💼', '👨‍💼', '👩‍💼', '🧑‍💻', '👨‍💻', '👩‍💻', '🧑‍🔬', '👨‍🔬', '👩‍🔬',
        '🧑‍🎨', '👨‍🎨', '👩‍🎨', '🧑‍✈️', '👨‍✈️', '👩‍✈️', '👮', '👮‍♂️', '👮‍♀️', '🕵️', '🕵️‍♂️', '🕵️‍♀️',
        '💂', '👷', '👷‍♂️', '👷‍♀️', '🤴', '👸', '👳', '👲', '🧔', '👱', '👨‍🦰', '👩‍🦰',
        '👨‍🦱', '👩‍🦱', '👨‍🦳', '👩‍🦳', '👨‍🦲', '👩‍🦲', '🤰', '🤱', '🦸', '🦹', '🧙', '🧚',
        '🧛', '🧜', '🧝', '🧞', '🧟', '💆', '💇', '🚶', '🏃', '💃', '🕺', '🕴️',
        '👯', '🧖', '🧘', '👐', '🙌', '👏', '👍', '👎', '👊', '✊', '🤛', '🤜',
        '🤝', '🤞', '🤟', '🤘', '👌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋'
      ]
    },
    {
      name: 'Oficina y Tecnología',
      emojis: [
        '💼', '📁', '📂', '🗂️', '📅', '📆', '🗒️', '🗓️', '📇', '📈', '📉', '📊',
        '📋', '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🗃️', '🗄️', '🗑️', '🔒',
        '🔓', '🔏', '🔐', '🔑', '🗝️', '🔨', '🛠️', '🔧', '🔩', '⚙️', '🗜️', '⚖️',
        '💻', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '💽', '💾', '💿', '📀', '📷', '📸',
        '📹', '🎥', '📽️', '📞', '☎️', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️',
        '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '💸', '💵', '💴',
        '💶', '💷', '💰', '💳', '💎'
      ]
    },
    {
      name: 'Símbolos y Estados',
      emojis: [
        '✅', '☑️', '✔️', '❌', '❎', '✳️', '❇️', '❗', '❓', '❕', '❔', '‼️', '⁉️',
        '⚠️', '🚸', '⛔', '🚫', '🚳', '🚭', '🚯', '🚱', '🚷', '📵', '🔞', '☢️', '☣️',
        '⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️', '↕️', '↔️', '↩️', '↪️', '⤴️',
        '⤵️', '🔃', '🔄', '🔙', '🔚', '🔛', '🔜', '🔝', '🛐', '⚛️', '🕉️', '✡️', '☸️',
        '☯️', '✝️', '☦️', '☪️', '☮️', '🕎', '🔯', '♈', '♉', '♊', '♋', '♌', '♍',
        '♎', '♏', '♐', '♑', '♒', '♓', '⛎', '🔀', '🔁', '🔂', '▶️', '⏩', '⏭️',
        '⏯️', '◀️', '⏪', '⏮️', '🔼', '⏫', '🔽', '⏬', '⏸️', '⏹️', '⏺️', '⏏️',
        '🎦', '🔅', '🔆', '📶', '📳', '📴', '♻️', '📛', '⚜️', '🔰', '🔱', '⭕'
      ]
    },
    {
      name: 'Formas y Colores',
      emojis: [
        '🔴', '🟠', '🟡', '🟢', '🟢', '🟣', '⚫', '⚪', '🟤', '🟥', '🟧', '🟨',
        '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷',
        '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🔈', '🔇', '🔉', '🔊',
        '🔔', '🔕', '📣', '📢', '👁️‍🗨️', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️',
        '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘',
        '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤',
        '🕥', '🕦', '🕧'
      ]
    },
    {
        name: 'Iconos de Material (Presets)',
        emojis: [
            'person', 'face', 'engineering', 'psychology', 'support_agent', 'admin_panel_settings',
            'badge', 'verified_user', 'supervised_user_circle', 'groups', 'work', 'store',
            'star', 'favorite', 'thumb_up', 'bolt', 'rocket_launch', 'school'
        ]
    }
  ];

  // Pre-calculate edges with paths for the template
  edgesWithPath = computed(() => {
    const edges = this.chartState.edges();
    const posMap = this.chartState.nodePositions();
    
    return edges.map(edge => {
      const source = posMap.get(edge.sourceId);
      const target = posMap.get(edge.targetId);
      let path = '';
      if (source && target) {
        path = this.getConnectorPath(source, target);
      }
      return { ...edge, path };
    });
  });

  ngAfterViewInit() {
    // Setup Resize Observer for minimap
    if (this.mainContainer) {
        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                this.canvasWidth.set(entry.contentRect.width);
                this.canvasHeight.set(entry.contentRect.height);
            }
        });
        this.resizeObserver.observe(this.mainContainer.nativeElement);
    }

    // Center the chart initially
    setTimeout(() => {
        this.zoomToFit();
    }, 100);
  }

  ngOnDestroy() {
      if (this.resizeObserver) {
          this.resizeObserver.disconnect();
      }
  }

  changeChartType(typeId: string) {
    this.currentType.set(typeId);
    switch (typeId) {
      case 'functional':
        this.chartState.loadFunctionalChart();
        break;
      case 'whiteboard':
        this.chartState.loadWhiteboard();
        break;
    }
    // Small delay to allow canvas to re-render before calculating bounds
    setTimeout(() => this.zoomToFit(), 100);
  }

  getSelectedTypeName() {
    return this.chartTypes.find(t => t.id === this.currentType())?.name || 'Structure';
  }

  toggleShortcutsModal() {
    this.showShortcutsModal.update(v => !v);
  }

  toggleLeftSidebar() {
    this.isLeftSidebarOpen.update(v => !v);
  }

  toggleRightSidebar() {
    this.isRightSidebarOpen.update(v => !v);
  }

  // --- Toolbar Logic ---

  setTool(tool: ToolMode) {
    this.activeTool.set(tool);
    this.chartState.clearSelection();
  }

  setToolColor(color: string) {
    this.toolColor.set(color);
  }
  
  setShapeToolType(type: ShapeType) {
    this.selectedShapeType.set(type);
  }

  // --- Connector Logic ---

  onNodeDimensionsChange(dims: {w: number, h: number}, nodeId: string) {
    this.chartState.updateNodeDimensions(nodeId, dims.w, dims.h);
  }
  
  onNodeTextChange(text: string, nodeId: string) {
     this.chartState.updateNode({ name: text });
  }

  getConnectorPath(source: NodePosition, target: NodePosition): string {
    const sourceW = source.width || 208; // fallback to default w-52
    const sourceH = source.height || 100; // fallback default
    const targetW = target.width || 208;
    
    // Start Center-Bottom of source
    const startX = source.x + sourceW / 2;
    const startY = source.y + sourceH; 
    
    // End Center-Top of target
    const endX = target.x + targetW / 2;
    const endY = target.y;

    // Logic for control points
    const verticalDist = endY - startY;
    
    if (verticalDist > 0) {
       // Target is below
       const midY = (startY + endY) / 2;
       // We want vertical exit
       const strength = Math.min(Math.abs(verticalDist) * 0.5, 80);
       
       // Standard cubic bezier with vertical bias
       return `M ${startX} ${startY} C ${startX} ${startY + strength}, ${endX} ${endY - strength}, ${endX} ${endY}`;
    } else {
       // Target is above or parallel
       const strength = 100;
       return `M ${startX} ${startY} C ${startX} ${startY + strength}, ${endX} ${endY - strength}, ${endX} ${endY}`;
    }
  }

  getGhostPath(): string {
     if (!this.linkStartPos || !this.linkCurrentPos) return '';
     
     const startX = this.linkStartPos.x;
     const startY = this.linkStartPos.y;
     const endX = this.linkCurrentPos.x;
     const endY = this.linkCurrentPos.y;

     // Simple bezier
     return `M ${startX} ${startY} C ${startX} ${startY + 50}, ${endX} ${endY - 50}, ${endX} ${endY}`;
  }

  // Properties Panel Handlers
  updateName(e: Event) {
    this.chartState.updateNode({ name: (e.target as HTMLInputElement).value });
  }

  updateRole(e: Event) {
    this.chartState.updateNode({ role: (e.target as HTMLInputElement).value });
  }

  updateDepartment(e: Event) {
    this.chartState.updateNode({ department: (e.target as HTMLInputElement).value });
  }
  
  updateLevel(e: Event) {
    this.chartState.updateNode({ level: (e.target as HTMLSelectElement).value });
  }
  
  // Typography Handlers
  updateTypography(prop: 'fontSize' | 'fontFamily', e: Event) {
      const val = (e.target as HTMLInputElement).value;
      if (prop === 'fontSize') {
          this.chartState.saveHistory();
          this.chartState.updateNode({ fontSize: parseInt(val, 10) });
      } else {
          this.chartState.saveHistory();
          this.chartState.updateNode({ fontFamily: val });
      }
  }

  toggleFontStyle(style: 'bold' | 'italic' | 'underline') {
      this.chartState.saveHistory();
      const node = this.chartState.selectedNode();
      if (!node) return;

      if (style === 'bold') {
          const newVal = node.fontWeight === 'bold' ? 'normal' : 'bold';
          this.chartState.updateNode({ fontWeight: newVal });
      } else if (style === 'italic') {
          const newVal = node.fontStyle === 'italic' ? 'normal' : 'italic';
          this.chartState.updateNode({ fontStyle: newVal });
      } else if (style === 'underline') {
          const newVal = node.textDecoration === 'underline' ? 'none' : 'underline';
          this.chartState.updateNode({ textDecoration: newVal });
      }
  }

  // Avatar Handlers
  setAvatarType(type: 'image' | 'icon') {
     this.chartState.saveHistory();
     this.chartState.updateNode({ avatarType: type });
  }

  updateAvatarUrl(e: Event) {
    this.chartState.updateNode({ avatarImage: (e.target as HTMLInputElement).value });
  }

  updateAvatarIcon(e: Event) {
    this.chartState.updateNode({ avatarIcon: (e.target as HTMLInputElement).value });
  }
  
  selectEmoji(emoji: string) {
    this.chartState.saveHistory();
    this.chartState.updateNode({ avatarIcon: emoji, avatarType: 'icon' });
  }

  triggerFileUpload() {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.chartState.saveHistory();
      // Use URL.createObjectURL instead of Base64 to save memory and avoid long strings
      const blobUrl = URL.createObjectURL(file);
      this.chartState.updateNode({ avatarImage: blobUrl, avatarType: 'image' });
      // Clear input so same file can be selected again if needed
      input.value = '';
    }
  }

  // Color Handlers
  updateColor(property: 'nameColor' | 'roleColor' | 'departmentColor' | 'borderColor' | 'backgroundColor', e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.chartState.updateNode({ [property]: val });
  }
  
  // Method to set color directly from button
  setColor(property: 'nameColor' | 'roleColor' | 'departmentColor' | 'borderColor' | 'backgroundColor', color: string) {
    this.chartState.saveHistory();
    this.chartState.updateNode({ [property]: color });
  }

  // Update logic to allow typing hex manually
  updateColorHex(property: 'nameColor' | 'roleColor' | 'departmentColor' | 'borderColor' | 'backgroundColor', e: Event) {
     const val = (e.target as HTMLInputElement).value;
     // Basic hex validation
     if (/^#[0-9A-F]{6}$/i.test(val)) {
        this.chartState.updateNode({ [property]: val });
     }
  }

  updateBorderWidth(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    this.chartState.updateNode({ borderWidth: val });
  }
  
  updateShapeType(type: ShapeType) {
     this.chartState.saveHistory();
     this.chartState.updateNode({ shapeType: type });
  }

  updateBorderRadius(e: Event) {
     const val = parseInt((e.target as HTMLInputElement).value, 10);
     this.chartState.updateNode({ borderRadius: val });
  }

  deleteNode() {
    this.chartState.deleteSelectedNode();
  }
  
  deleteSelectedDrawing() {
      // Logic handled by generic deleteSelection in service now
      this.chartState.deleteSelection();
  }

  addMember() {
    this.chartState.addMember();
  }

  triggerJsonImport() {
    this.jsonImportInput.nativeElement.click();
  }

  onJsonFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        this.chartState.importFromJson(data);
        
        // Small delay to allow canvas to re-render before calculating bounds
        setTimeout(() => this.zoomToFit(), 100);

      } catch (error) {
        console.error('Error parsing JSON file:', error);
        alert('Failed to import JSON. The file might be corrupted or in the wrong format.');
      } finally {
        // Clear the input value to allow selecting the same file again
        if (input) {
          input.value = '';
        }
      }
    };
    reader.readAsText(file);
  }

  onKeyDown(event: KeyboardEvent) {
    const activeTag = document.activeElement?.tagName;
    const isEditing = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

    // 1. Delete Logic
    if (event.key === 'Delete' || event.key === 'Backspace') {
       if (isEditing) return;
       
       if (event.repeat) return; // Prevent spamming delete on hold if desired

       if (this.chartState.selectedEdgeId()) {
         event.preventDefault(); // Prevent browser navigation on Backspace
         this.chartState.deleteSelectedEdge();
       } else if (this.chartState.selectionCount() > 0) {
         event.preventDefault(); // Prevent browser navigation on Backspace
         this.chartState.deleteSelection();
       }
       return;
    }
    
    // 2. Clipboard & History Logic
    if (event.ctrlKey || event.metaKey) {
        if (event.repeat) return; // Prevent multiple executions if key is held

        // SELECT ALL
        if (event.key === 'a' || event.key === 'A') {
          if (isEditing) return;
          event.preventDefault();
          this.chartState.selectAll();
          return;
        }

        // UNDO / REDO
        if (event.key === 'z' || event.key === 'Z') {
          event.preventDefault(); // Prevent browser default undo
          if (event.shiftKey) {
             this.chartState.redo();
          } else {
             this.chartState.undo();
          }
          return;
        }

        if (event.key === 'y' || event.key === 'Y') {
          event.preventDefault();
          this.chartState.redo();
          return;
        }

        if (event.key === 'c' || event.key === 'C') {
             if (isEditing && window.getSelection()?.toString()) return; // Allow native copy if text selected
             this.chartState.copySelection();
        } else if (event.key === 'x' || event.key === 'X') {
             if (isEditing && window.getSelection()?.toString()) return;
             this.chartState.copySelection();
             this.chartState.deleteSelection();
        } else if (event.key === 'v' || event.key === 'V') {
             if (isEditing) return; // Allow native paste in inputs

             event.preventDefault(); // Prevent default browser paste behavior

             let targetX = 0;
             let targetY = 0;

             if (this.isMouseOverCanvas && this.lastMouseWorldPos) {
                 // Paste at cursor
                 targetX = this.lastMouseWorldPos.x;
                 targetY = this.lastMouseWorldPos.y;
             } else {
                 // Paste at center of viewport
                 const el = this.mainContainer.nativeElement;
                 const scale = this.chartState.zoomLevel() / 100;
                 const pan = this.chartState.panOffset();
                 
                 // Center of screen in World Coords
                 targetX = (el.clientWidth / 2 - pan.x) / scale;
                 targetY = (el.clientHeight / 2 - pan.y) / scale;
             }

             this.chartState.pasteNodes(targetX, targetY);
        }
    }
    
    if (event.code === 'Space' && !this.isSpacePressed) {
      if (isEditing) return;
      this.isSpacePressed = true;
    }
  }
  
  onKeyUp(event: KeyboardEvent) {
    if (event.code === 'Space') {
      this.isSpacePressed = false;
      this.isPanning = false;
    }
  }

  onDocumentClick(event: MouseEvent) {
    if (this.isExportMenuOpen() && this.exportButtonContainer && !this.exportButtonContainer.nativeElement.contains(event.target as Node)) {
      this.isExportMenuOpen.set(false);
    }
  }

  onEdgeClick(event: MouseEvent, edgeId: string) {
    event.stopPropagation();
    this.chartState.selectEdge(edgeId);
  }
  
  onDrawingMouseDown(event: MouseEvent | TouchEvent, drawingId: string) {
      event.stopPropagation();
      const isMulti = 'shiftKey' in event && (event.shiftKey || event.ctrlKey);
      
      if (this.activeTool() === 'eraser') {
          this.chartState.deleteDrawing(drawingId);
      } else {
          this.chartState.selectDrawing(drawingId, isMulti);
          
          const pointer = 'touches' in event ? event.touches[0] : event;
          // Initiate Drawing Drag
          if (!('button' in event) || ('button' in event && event.button === 0)) {
              this.isDraggingDrawing = true;
              this.dragStartOffset = { x: pointer.clientX, y: pointer.clientY };
              this.chartState.saveHistory(); // Save before moving
          }
      }
  }

  // Zoom Controls
  zoomIn() { this.chartState.zoomLevel.update(v => Math.min(v + 10, 500)); }
  zoomOut() { this.chartState.zoomLevel.update(v => Math.max(v - 10, 10)); }
  resetZoom() { this.chartState.zoomLevel.set(100); this.chartState.panOffset.set({x: 0, y: 0}); }
  zoomToFit() {
      const el = this.mainContainer.nativeElement;
      this.chartState.zoomToFit(el.clientWidth, el.clientHeight);
  }

  // --- Interaction Logic ---

  onWheel(event: WheelEvent) {
    event.preventDefault();

    if (event.ctrlKey || event.metaKey) {
       // Zoom
       const delta = -event.deltaY;
       const zoomChange = delta > 0 ? 10 : -10;
       const current = this.chartState.zoomLevel();
       const newZoom = Math.min(Math.max(current + zoomChange, 10), 500);
       this.chartState.zoomLevel.set(newZoom);
    } else {
       // Pan
       this.chartState.updatePan(-event.deltaX, -event.deltaY);
    }
  }

  onNodeMouseDown(event: MouseEvent | TouchEvent, nodeId: string) {
     event.stopPropagation(); 
     
     // Eraser Tool
     if (this.activeTool() === 'eraser') {
         this.chartState.selectNode(nodeId); // Select temporarily to delete
         this.chartState.deleteSelectedNode();
         return;
     }

     // Hand tool overrides selection/drag unless link is starting
     if (this.activeTool() === 'hand') {
         this.isPanning = true;
         return;
     }

     // Allow Panning even if clicked on a node if Space is held
     if (this.isSpacePressed || ('button' in event && event.button === 1)) {
       this.isPanning = true;
       return;
     }

     if ('button' in event && event.button !== 0) return;

     // SAVE STATE BEFORE DRAGGING STARTS
     this.chartState.saveHistory();

     this.isDraggingNode = true;
     this.dragNodeId = nodeId;
     
     const isMultiSelect = 'shiftKey' in event && (event.shiftKey || event.ctrlKey);
     if (!isMultiSelect && !this.chartState.selectedNodeIds().has(nodeId)) {
        this.chartState.selectNode(nodeId);
     } else if (!this.chartState.selectedNodeIds().has(nodeId)) {
        this.chartState.selectNode(nodeId, true);
     }
     
     const pointer = 'touches' in event ? event.touches[0] : event;
     this.dragStartOffset = { x: pointer.clientX, y: pointer.clientY };
  }

  onLinkStart(event: MouseEvent | TouchEvent, nodeId: string) {
    if (this.isSpacePressed || ('button' in event && event.button === 1) || this.activeTool() === 'hand' || this.activeTool() === 'eraser') return;

    // Started dragging the link handle
    this.isLinking = true;
    this.linkSourceId = nodeId;
    
    // Calculate start position (bottom center of card)
    const pos = this.chartState.nodePositions().get(nodeId);
    if (pos) {
       // Use dynamic dimensions
       const w = pos.width || 208;
       const h = pos.height || 100;
       
       this.linkStartPos = { x: pos.x + w / 2, y: pos.y + h };
       
       const pointer = 'touches' in event ? event.touches[0] : event;
       // Initial placeholder needs to be in world coordinates
       const scale = this.chartState.zoomLevel() / 100;
       const rect = this.mainContainer.nativeElement.getBoundingClientRect();
       const pan = this.chartState.panOffset();
       const x = (pointer.clientX - rect.left - pan.x) / scale;
       const y = (pointer.clientY - rect.top - pan.y) / scale;
       
       this.linkCurrentPos = { x, y }; 
    }
  }

  onCanvasMouseDown(event: MouseEvent | TouchEvent) {
    const isTouchEvent = 'touches' in event;

    if (isTouchEvent) {
        if (event.touches.length > 1) {
            this.isPinching = true;
            this.lastPinchDistance = null; // Reset for new pinch
            return;
        }
        this.isPinching = false;
    }

    const tool = this.activeTool();
    const pointer = isTouchEvent ? event.touches[0] : event;

    // 1. Hand Tool / Panning
    if (tool === 'hand' || ('button' in pointer && pointer.button === 1) || (this.isSpacePressed && ('button' in pointer && pointer.button === 0))) {
       event.preventDefault();
       this.isPanning = true;
       return;
    }

    if ('button' in pointer && pointer.button !== 0) return;

    const rect = this.mainContainer.nativeElement.getBoundingClientRect();
    const scale = this.chartState.zoomLevel() / 100;
    const pan = this.chartState.panOffset();
    const worldX = (pointer.clientX - rect.left - pan.x) / scale;
    const worldY = (pointer.clientY - rect.top - pan.y) / scale;
    
    // 2. Eraser Tool
    if (tool === 'eraser') {
        this.isSelecting = true; 
        this.checkEraserCollision(worldX, worldY);
        return;
    }

    // 3. Note / Shape / Text Tool (Click to create)
    if (tool === 'note' || tool === 'shape' || tool === 'text') {
       this.chartState.addNode(tool, worldX, worldY, {
           backgroundColor: tool === 'text' ? '#F0EEE9' : this.toolColor(),
           nameColor: tool === 'text' ? '#0f172a' : '#1e293b', 
           shapeType: tool === 'shape' ? this.selectedShapeType() : 'rectangle'
       });
       this.setTool('select');
       return;
    }
    
    // 4. Group Tool (Drag to Create)
    if (tool === 'group') {
        this.isCreatingGroup = true;
        this.selectionStart = { x: pointer.clientX - rect.left, y: pointer.clientY - rect.top };
        this.selectionBox = { left: this.selectionStart.x, top: this.selectionStart.y, width: 0, height: 0 };
        return;
    }

    // 5. Pen Tool
    if (tool === 'pen') {
       this.isDrawing = true;
       this.currentPoints = [{x: worldX, y: worldY}];
       this.updateCurrentPathString();
       return;
    }

    // 6. Select Tool
    this.isSelecting = true;
    this.selectionStart = { x: pointer.clientX - rect.left, y: pointer.clientY - rect.top };
    this.selectionBox = { left: this.selectionStart.x, top: this.selectionStart.y, width: 0, height: 0 };

    const isMultiSelect = 'shiftKey' in event && (event.shiftKey || event.ctrlKey);
    if (!isMultiSelect) {
      this.chartState.clearSelection();
    }
  }
  
  // Helper to handle mouse entering/leaving the main canvas
  onMouseEnter() { this.isMouseOverCanvas = true; }
  
  onMouseLeave() { this.isMouseOverCanvas = false; }

  onCanvasMouseMove(event: MouseEvent | TouchEvent) {
    const isTouchEvent = 'touches' in event;
    if (isTouchEvent) {
        event.preventDefault();
    }

    // Handle Pinch-to-Zoom
    if (isTouchEvent && event.touches.length === 2) {
        this.isPinching = true;
        // Cancel other interactions
        this.isPanning = this.isDrawing = this.isLinking = this.isDraggingNode = this.isSelecting = this.isCreatingGroup = false;
        this.selectionBox = null;

        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const newDist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);

        if (this.lastPinchDistance !== null) {
            const delta = newDist - this.lastPinchDistance;
            const zoomChange = delta * 0.5; // Sensitivity
            this.chartState.zoomLevel.update(v => Math.min(Math.max(v + zoomChange, 10), 500));
        }
        this.lastPinchDistance = newDist;
        return; // Stop processing for single pointer
    }
    
    if (this.isPinching) return;

    const pointer = isTouchEvent ? event.touches[0] : event;
    if (!pointer) return; // No pointer data if all fingers lifted

    const scale = this.chartState.zoomLevel() / 100;
    const rect = this.mainContainer.nativeElement.getBoundingClientRect();
    const pan = this.chartState.panOffset();
    const worldX = (pointer.clientX - rect.left - pan.x) / scale;
    const worldY = (pointer.clientY - rect.top - pan.y) / scale;

    this.lastMouseWorldPos = { x: worldX, y: worldY };
    this.isMouseOverCanvas = true;

    if (this.isPanning) {
      const movementX = 'movementX' in event ? event.movementX : (pointer.clientX - this.dragStartOffset.x);
      const movementY = 'movementY' in event ? event.movementY : (pointer.clientY - this.dragStartOffset.y);
      this.chartState.updatePan(movementX, movementY);
      if(isTouchEvent) this.dragStartOffset = { x: pointer.clientX, y: pointer.clientY };
      return;
    }

    if (this.isDrawing && this.activeTool() === 'pen') {
        this.currentPoints.push({x: worldX, y: worldY});
        this.updateCurrentPathString();
        return;
    }
    
    if (this.isSelecting && this.activeTool() === 'eraser') {
        this.checkEraserCollision(worldX, worldY);
        return;
    }

    if (this.isLinking && this.linkStartPos) {
       this.linkCurrentPos = { x: worldX, y: worldY };
       return;
    }

    if (this.isDraggingNode && this.dragNodeId) {
        event.preventDefault();
        
        const dx = (pointer.clientX - this.dragStartOffset.x) / scale;
        const dy = (pointer.clientY - this.dragStartOffset.y) / scale;

        this.dragStartOffset = { x: pointer.clientX, y: pointer.clientY };

        const idsToMove = this.chartState.selectedNodeIds().has(this.dragNodeId) 
             ? Array.from(this.chartState.selectedNodeIds()) 
             : [this.dragNodeId];

        const positions = this.chartState.nodePositions();
        
        idsToMove.forEach(id => {
           const pos = positions.get(id);
           if (pos) {
              this.chartState.updateNodePosition(id, pos.x + dx, pos.y + dy);
           }
        });
        return;
    }
    
    if (this.isDraggingDrawing) {
        event.preventDefault();
        
        const dx = (pointer.clientX - this.dragStartOffset.x) / scale;
        const dy = (pointer.clientY - this.dragStartOffset.y) / scale;
        
        this.dragStartOffset = { x: pointer.clientX, y: pointer.clientY };
        
        this.chartState.moveSelectedDrawings(dx, dy);
        return;
    }

    if ((this.isSelecting || this.isCreatingGroup) && this.selectionBox) {
        const currentX = pointer.clientX - rect.left;
        const currentY = pointer.clientY - rect.top;

        const left = Math.min(this.selectionStart.x, currentX);
        const top = Math.min(this.selectionStart.y, currentY);
        const width = Math.abs(currentX - this.selectionStart.x);
        const height = Math.abs(currentY - this.selectionStart.y);

        this.selectionBox = { left, top, width, height };
    }
  }

  onCanvasMouseUp(event: MouseEvent | TouchEvent) {
    if (this.isPinching) {
        this.isPinching = false;
        this.lastPinchDistance = null;
        return;
    }

    if (this.isPanning) {
      this.isPanning = false;
      return;
    }
    
    if (this.isDraggingDrawing) {
        this.isDraggingDrawing = false;
        return;
    }

    // 1. End Drawing
    if (this.isDrawing) {
       this.isDrawing = false;
       if (this.currentPoints.length > 1) {
          const smoothedPath = this.getQuadraticPath(this.currentPoints);
          this.chartState.addDrawing({
              id: Math.random().toString(36).substr(2, 9),
              path: smoothedPath,
              color: this.toolColor(),
              strokeWidth: 3
          });
       }
       this.currentPathString = '';
       this.currentPoints = [];
       return;
    }

    // 2. End Linking
    if (this.isLinking) {
       const targetEl = (event.target as HTMLElement).closest('[data-node-id]');
       if (targetEl) {
          const targetId = targetEl.getAttribute('data-node-id');
          if (targetId && this.linkSourceId && targetId !== this.linkSourceId) {
             this.chartState.linkNodes(this.linkSourceId, targetId);
          }
       }
       this.isLinking = false;
       this.linkSourceId = null;
       this.linkStartPos = null;
       return;
    }
    
    // 3. End Group Creation
    if (this.isCreatingGroup) {
        if (this.selectionBox && this.selectionBox.width > 20 && this.selectionBox.height > 20) {
            const scale = this.chartState.zoomLevel() / 100;
            const pan = this.chartState.panOffset();
            const worldX = (this.selectionBox.left - pan.x) / scale;
            const worldY = (this.selectionBox.top - pan.y) / scale;
            const worldW = this.selectionBox.width / scale;
            const worldH = this.selectionBox.height / scale;

            this.chartState.addNode('group', worldX, worldY, {
                backgroundColor: this.toolColor()
            }, { width: worldW, height: worldH });
        } else {
             const pointer = 'changedTouches' in event ? event.changedTouches[0] : event;
             const rect = this.mainContainer.nativeElement.getBoundingClientRect();
             const scale = this.chartState.zoomLevel() / 100;
             const pan = this.chartState.panOffset();
             const worldX = (pointer.clientX - rect.left - pan.x) / scale;
             const worldY = (pointer.clientY - rect.top - pan.y) / scale;
             this.chartState.addNode('group', worldX, worldY, {
                 backgroundColor: this.toolColor()
             });
        }
        
        this.isCreatingGroup = false;
        this.selectionBox = null;
        this.setTool('select');
        return;
    }

    if (this.isDraggingNode) {
        if (this.dragNodeId) {
           const node = this.chartState.nodes().get(this.dragNodeId);
           if (node) {
              if (node.type === 'group') {
                 this.chartState.updateGroupMembership(this.dragNodeId);
              } else {
                 this.chartState.updateNodeMembership(this.dragNodeId);
              }
           }
        }

        this.isDraggingNode = false;
        this.dragNodeId = null;
        return;
    }

    if (this.isSelecting) {
        if (this.activeTool() === 'select') {
            if (this.selectionBox && this.selectionBox.width > 5 && this.selectionBox.height > 5) {
                this.calculateSelectionIntersect();
            } else if (!('shiftKey' in event && (event.shiftKey || event.ctrlKey))) {
                 this.chartState.clearSelection();
            }
        }
        this.isSelecting = false;
        this.selectionBox = null;
    }
  }
  
  checkEraserCollision(worldX: number, worldY: number) {
      const threshold = 10; 
      const drawings = this.chartState.drawings();
      
      drawings.forEach(d => {
          const b = this.chartState.getDrawingBounds(d.path);
          if (worldX >= b.x - threshold && worldX <= b.x + b.w + threshold &&
              worldY >= b.y - threshold && worldY <= b.y + b.h + threshold) {
              this.chartState.deleteDrawing(d.id);
          }
      });
  }

  updateCurrentPathString() {
     if (this.currentPoints.length < 2) return;
     const start = this.currentPoints[0];
     let d = `M ${start.x} ${start.y}`;
     for(let i = 1; i < this.currentPoints.length; i++) {
        d += ` L ${this.currentPoints[i].x} ${this.currentPoints[i].y}`;
     }
     this.currentPathString = d;
  }

  /**
   * Converts an array of points into a smoothed SVG path string using quadratic Bézier curves.
   * This makes drawings feel more natural, especially with a stylus like Apple Pencil.
   * @param points The array of points from the drawing action.
   * @returns A smoothed SVG path data string.
   */
  private getQuadraticPath(points: { x: number; y: number }[]): string {
    if (points.length < 3) {
      if (!points || points.length === 0) return '';
      let d = `M${points[0].x},${points[0].y}`;
      for (let i = 1; i < points.length; i++) d += ` L${points[i].x},${points[i].y}`;
      return d;
    }

    let path = `M${points[0].x},${points[0].y}`;
    let i: number;
    for (i = 1; i < points.length - 2; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        path += ` Q${points[i].x},${points[i].y} ${xc},${yc}`;
    }
    // For the last 2 points, curve to the last point
    path += ` Q${points[i].x},${points[i].y} ${points[i + 1].x},${points[i + 1].y}`;
    return path;
  }
  
  private calculateSelectionIntersect() {
    if (!this.selectionBox) return;
    const containerRect = this.mainContainer.nativeElement.getBoundingClientRect();
    const selectionRect = {
      left: containerRect.left + this.selectionBox.left,
      top: containerRect.top + this.selectionBox.top,
      right: containerRect.left + this.selectionBox.left + this.selectionBox.width,
      bottom: containerRect.top + this.selectionBox.top + this.selectionBox.height
    };

    const nodes = document.querySelectorAll('[data-node-id]');
    const currentSelection = new Set(this.chartState.selectedNodeIds());

    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      const intersects = !(rect.right < selectionRect.left || rect.left > selectionRect.right || rect.bottom < selectionRect.top || rect.top > selectionRect.bottom);
      if (intersects) {
        const id = el.getAttribute('data-node-id');
        if (id) currentSelection.add(id);
      }
    });
    
    const currentDrawingSelection = new Set(this.chartState.selectedDrawingIds());
    const scale = this.chartState.zoomLevel() / 100;
    const pan = this.chartState.panOffset();
    
    const selWorldX = (this.selectionBox.left - pan.x) / scale;
    const selWorldY = (this.selectionBox.top - pan.y) / scale;
    const selWorldW = this.selectionBox.width / scale;
    const selWorldH = this.selectionBox.height / scale;
    const selWorldRect = { x: selWorldX, y: selWorldY, w: selWorldW, h: selWorldH };

    this.chartState.drawings().forEach(d => {
        const b = this.chartState.getDrawingBounds(d.path);
        const overlap = Math.max(0, Math.min(selWorldRect.x + selWorldRect.w, b.x + b.w) - Math.max(selWorldRect.x, b.x)) * 
                        Math.max(0, Math.min(selWorldRect.y + selWorldRect.h, b.y + b.h) - Math.max(selWorldRect.y, b.y));
        
        if (overlap > 0) {
            currentDrawingSelection.add(d.id);
        }
    });

    this.chartState.clearSelection();
    currentSelection.forEach(id => this.chartState.selectNode(id, true));
    currentDrawingSelection.forEach(id => this.chartState.selectDrawing(id, true));
  }

  toggleExportMenu() {
    this.isExportMenuOpen.update(v => !v);
  }

  private downloadFile(content: string, fileName: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  exportAsJson() {
    this.isExportMenuOpen.set(false);
    const data = {
      nodes: Array.from(this.chartState.nodes().entries()),
      positions: Array.from(this.chartState.nodePositions().entries()),
      drawings: this.chartState.drawings(),
    };
    const jsonString = JSON.stringify(data, null, 2);
    this.downloadFile(jsonString, 'chartflow-export.json', 'application/json');
  }
}
