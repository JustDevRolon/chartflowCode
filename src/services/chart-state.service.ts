import { Injectable, signal, computed } from '@angular/core';

export interface ChartNode {
  id: string;
  name: string;
  role: string;
  department?: string;
  type: 'executive' | 'manager' | 'employee' | 'note' | 'shape' | 'group' | 'text';
  
  // Shape specific
  shapeType?: 'rectangle' | 'circle' | 'triangle' | 'star' | 'diamond';
  borderRadius?: number;

  // Text specific
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string; // 'normal' | 'bold'
  fontStyle?: string; // 'normal' | 'italic'
  textDecoration?: string; // 'none' | 'underline'
  textAlign?: 'left' | 'center' | 'right';

  // Avatar logic
  avatarType: 'image' | 'icon'; 
  avatarImage?: string; // Stores URL or Blob URL
  avatarIcon?: string;  // Stores Emoji or Material Icon name
  
  level?: string; // P0 - P7
  children?: string[]; 
  
  // Styling props
  backgroundColor?: string; 
  nameColor?: string;
  roleColor?: string;
  departmentColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface NodePosition {
  x: number;
  y: number;
  width?: number; // Dynamic width
  height?: number; // Dynamic height
}

export interface ChartEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface Drawing {
  id: string;
  path: string; // SVG Path 'd' attribute
  color: string;
  strokeWidth: number;
}

interface ClipboardItem {
  type: 'node' | 'drawing';
  data: ChartNode | Drawing;
  x: number; // Position reference for offset
  y: number;
  width: number;
  height: number;
}

// Interface for History
interface HistorySnapshot {
  nodes: [string, ChartNode][]; // Map entries as array for JSON safety
  positions: [string, NodePosition][]; // Map entries
  drawings: Drawing[];
}

@Injectable({
  providedIn: 'root'
})
export class ChartStateService {
  // State Signals
  nodes = signal<Map<string, ChartNode>>(new Map());
  nodePositions = signal<Map<string, NodePosition>>(new Map());
  drawings = signal<Drawing[]>([]);
  
  selectedNodeIds = signal<Set<string>>(new Set()); 
  selectedDrawingIds = signal<Set<string>>(new Set());
  selectedEdgeId = signal<string | null>(null);
  
  zoomLevel = signal<number>(100);
  panOffset = signal<{x: number, y: number}>({ x: 0, y: 0 });

  // Dark Mode State
  isDarkMode = signal<boolean>(false);

  // History Stacks
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private maxHistorySize = 50; // Limit history to save memory

  // Clipboard
  private clipboard: ClipboardItem[] = [];

  // Computed Edges for Rendering
  edges = computed(() => {
    const edges: ChartEdge[] = [];
    const nodeMap = this.nodes();
    
    nodeMap.forEach((node: ChartNode) => {
      if (node.children) {
        node.children.forEach(childId => {
          // Verify child exists
          if (nodeMap.has(childId)) {
            edges.push({
              id: `${node.id}-${childId}`,
              sourceId: node.id,
              targetId: childId
            });
          }
        });
      }
    });
    return edges;
  });

  // Computed: Used for rendering the nodes
  flatNodes = computed(() => {
    const list: { data: ChartNode; x: number; y: number; width?: number; height?: number }[] = [];
    const positions = this.nodePositions();
    
    // Convert to array and sort: Groups first (render at bottom), then others
    const sortedNodes = Array.from(this.nodes().values()).sort((a: ChartNode, b: ChartNode) => {
      if (a.type === 'group' && b.type !== 'group') return -1;
      if (a.type !== 'group' && b.type === 'group') return 1;
      return 0;
    });

    sortedNodes.forEach((node: ChartNode) => {
      const pos = positions.get(node.id) || { x: 0, y: 0 };
      list.push({ 
        data: node, 
        x: pos.x, 
        y: pos.y, 
        width: pos.width, 
        height: pos.height 
      });
    });
    return list;
  });

  selectedNode = computed(() => {
    const ids = this.selectedNodeIds();
    if (ids.size === 0) return null;
    const lastId = Array.from(ids).pop() as string;
    return this.nodes().get(lastId) || null;
  });

  selectionCount = computed(() => this.selectedNodeIds().size + this.selectedDrawingIds().size);

  constructor() {
    this.loadFunctionalChart(false);
  }

  toggleDarkMode() {
    this.isDarkMode.update(v => !v);
    if (this.isDarkMode()) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // --- History Management ---

  saveHistory() {
    const snapshot: HistorySnapshot = {
      // Deep copy maps by converting to array of entries and stringifying
      nodes: JSON.parse(JSON.stringify(Array.from(this.nodes().entries()))),
      positions: JSON.parse(JSON.stringify(Array.from(this.nodePositions().entries()))),
      drawings: JSON.parse(JSON.stringify(this.drawings()))
    };

    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift(); // Remove oldest
    }
    this.redoStack = []; // Clear redo stack on new action
  }

  undo() {
    if (this.undoStack.length === 0) return;

    // Save current state to redo stack
    const currentSnapshot: HistorySnapshot = {
      nodes: Array.from(this.nodes().entries()),
      positions: Array.from(this.nodePositions().entries()),
      drawings: this.drawings()
    };
    this.redoStack.push(currentSnapshot);

    // Pop from undo and apply
    const prevSnapshot = this.undoStack.pop();
    if (prevSnapshot) {
      this.applySnapshot(prevSnapshot);
    }
  }

  redo() {
    if (this.redoStack.length === 0) return;

    // Save current state to undo stack (without clearing redo)
    const currentSnapshot: HistorySnapshot = {
      nodes: Array.from(this.nodes().entries()),
      positions: Array.from(this.nodePositions().entries()),
      drawings: this.drawings()
    };
    this.undoStack.push(currentSnapshot);

    // Pop from redo and apply
    const nextSnapshot = this.redoStack.pop();
    if (nextSnapshot) {
      this.applySnapshot(nextSnapshot);
    }
  }

  private applySnapshot(snapshot: HistorySnapshot) {
    this.nodes.set(new Map(snapshot.nodes));
    this.nodePositions.set(new Map(snapshot.positions));
    this.drawings.set(snapshot.drawings);
    
    // Clear selection on undo/redo to avoid ghost selections
    this.clearSelection();
  }
  
  private clearChart() {
    this.nodes.set(new Map());
    this.nodePositions.set(new Map());
    this.drawings.set([]);
    this.clearSelection();
  }

  private _addNode(map: Map<string, ChartNode>, pos: Map<string, NodePosition>, id: string, name: string, role: string, type: ChartNode['type'], dept: string, x: number, y: number, children: string[] = [], options: Partial<ChartNode> = {}) {
      map.set(id, {
        id, name, role, type, department: dept, children,
        avatarType: 'icon', avatarIcon: 'person',
        backgroundColor: '#ffffff', borderColor: '#cbd5e1', borderWidth: 2,
        nameColor: '#0f172a', roleColor: '#475569', departmentColor: '#64748b',
        level: type === 'group' ? undefined : 'P4 - Facilitar',
        shapeType: 'rectangle', borderRadius: 8,
        ...options
      });
      pos.set(id, { x, y, width: 208, height: 100 });
  }

  private addGroup(map: Map<string, ChartNode>, pos: Map<string, NodePosition>, id: string, name: string, x: number, y: number, width: number, height: number) {
      map.set(id, {
        id, name, role: '', type: 'group', department: '', children: [],
        avatarType: 'icon',
        backgroundColor: '#fef9c3', // Light yellow like screenshot
        borderColor: '#fde047',
        borderWidth: 2,
        nameColor: '#854d0e',
        roleColor: '', departmentColor: '',
        shapeType: 'rectangle', borderRadius: 16
      });
      pos.set(id, { x, y, width, height });
  }

  // --- Chart Template Loaders ---

  loadFunctionalChart(saveState = true) {
    if (saveState) this.saveHistory();
    const map = new Map<string, ChartNode>();
    const pos = new Map<string, NodePosition>();

    // These positions are just placeholders, autoLayout will fix them.
    this.addGroup(map, pos, 'g1', 'Management', 500, 50, 300, 300);
    this.addGroup(map, pos, 'g2', 'Growth', 200, 250, 300, 300);
    this.addGroup(map, pos, 'g3', 'Product', 800, 250, 300, 300);

    this._addNode(map, pos, '1', 'Sarah Connor', 'CEO / Founder', 'executive', 'Management', 600, 50, ['2', '3']);
    this._addNode(map, pos, '2', 'James Wright', 'Marketing VP', 'manager', 'Growth', 350, 250, ['2-1', '2-2']);
    this._addNode(map, pos, '2-1', 'Growth Team', 'Lead', 'employee', 'Growth', 250, 450);
    this._addNode(map, pos, '2-2', 'Brand Team', 'Lead', 'employee', 'Growth', 450, 450);
    this._addNode(map, pos, '3', 'Emily Chen', 'Engineering VP', 'manager', 'Product', 850, 250, ['3-1', '3-2']);
    this._addNode(map, pos, '3-1', 'Frontend', 'Team A', 'employee', 'Product', 750, 450);
    this._addNode(map, pos, '3-2', 'Backend', 'Team B', 'employee', 'Product', 950, 450);

    const n1 = map.get('1');
    if (n1) { n1.avatarType = 'icon'; n1.avatarIcon = '👩‍💼'; }

    this.nodes.set(map);
    this.nodePositions.set(pos);
    this.autoLayout(false);
  }

  loadWhiteboard(saveState = true) {
    if (saveState) this.saveHistory();
    this.clearChart();
  }
  
  // --- Enhanced Layout Algorithm ---

  autoLayout(saveState = true) {
    if (saveState) this.saveHistory();

    const currentPositions = this.nodePositions(); 
    const map = this.nodes();
    
    // STEP 0.5: Capture relationships between Text/Notes and Groups (Visual Containment)
    // This allows text elements inside groups to "move with" the group after layout
    const anchoredNodes = new Map<string, { groupId: string, offsetX: number, offsetY: number }>();
    
    map.forEach((node: ChartNode) => {
        // We only care about maintaining position for 'text', 'note', or 'shape' inside a group
        if (node.type === 'text' || node.type === 'note' || node.type === 'shape') {
            const nodePos = currentPositions.get(node.id);
            if (!nodePos) return;
            
            // Check intersection with all groups
            map.forEach((group: ChartNode) => {
                if (group.type === 'group') {
                    const groupPos = currentPositions.get(group.id);
                    if (groupPos) {
                        // Check if node center is inside group
                        const nodeCx = nodePos.x + (nodePos.width || 0) / 2;
                        const nodeCy = nodePos.y + (nodePos.height || 0) / 2;
                        
                        if (nodeCx >= groupPos.x && nodeCx <= groupPos.x + (groupPos.width || 0) &&
                            nodeCy >= groupPos.y && nodeCy <= groupPos.y + (groupPos.height || 0)) {
                            
                            // It is inside! Store relative offset from top-left of group
                            anchoredNodes.set(node.id, {
                                groupId: group.id,
                                offsetX: nodePos.x - groupPos.x,
                                offsetY: nodePos.y - groupPos.y
                            });
                        }
                    }
                }
            });
        }
    });


    const newPositions = new Map<string, NodePosition>();
    
    // Config Constants
    const CARD_WIDTH = 250; 
    const LEVEL_HEIGHT = 400; 
    const GROUP_PADDING = 150; 
    const GROUP_MARGIN = 800; 
    const NODE_MARGIN = 80;    

    // 0. Pre-process: Sort Children by Department to keep groups contiguous
    this.sortChildrenByDepartment(map);

    // Helper: Calculate the width required for a subtree
    const measureSubtree = (nodeId: string): number => {
       const node = map.get(nodeId);
       if (!node) return 0;
       
       if (!node.children || node.children.length === 0) {
          return CARD_WIDTH;
       }
       
       let totalWidth = 0;
       const children = node.children;
       
       let i = 0;
       while (i < children.length) {
          const startNode = map.get(children[i]);
          const startDept = startNode?.department || '';
          let blockWidth = 0;
          const blockStart = i;
          while (i < children.length) {
             const currNode = map.get(children[i]);
             const currDept = currNode?.department || '';
             if (currDept !== startDept) break; 
             if (i > blockStart) blockWidth += NODE_MARGIN;
             blockWidth += measureSubtree(children[i]);
             i++;
          }
          if (startDept) blockWidth += (GROUP_PADDING * 2); 
          totalWidth += blockWidth;
          if (i < children.length) totalWidth += GROUP_MARGIN;
       }
       return totalWidth;
    };

    // Helper: Recursively position nodes
    const executeLayout = (nodeId: string, x: number, depth: number) => {
       const node = map.get(nodeId);
       if (!node) return;
       
       const totalW = measureSubtree(nodeId);
       const contentCenter = x + totalW / 2;
       
       const oldPos = currentPositions.get(nodeId);
       const width = oldPos?.width || 208;
       const height = oldPos?.height || 100;
       
       newPositions.set(nodeId, { 
           x: contentCenter - (width / 2), 
           y: depth * LEVEL_HEIGHT + 50,
           width, 
           height 
       });

       if (!node.children || node.children.length === 0) return;
       
       let currentX = x;
       let i = 0;
       while (i < node.children.length) {
          const startChildId = node.children[i];
          const startNode = map.get(startChildId);
          const startDept = startNode?.department || '';
          const blockStartIdx = i;
          
          if (startDept) currentX += GROUP_PADDING;
          
          while (i < node.children.length) {
             const currChildId = node.children[i];
             const currNode = map.get(currChildId);
             const currDept = currNode?.department || '';
             if (currDept !== startDept) break;
             
             if (i > blockStartIdx) currentX += NODE_MARGIN;

             const childW = measureSubtree(currChildId);
             executeLayout(currChildId, currentX, depth + 1);
             currentX += childW;
             i++;
          }
          if (startDept) currentX += GROUP_PADDING;
          if (i < node.children.length) currentX += GROUP_MARGIN;
       }
    };

    // 1. Identify Roots and Layout
    const childrenSet = new Set<string>();
    map.forEach((n: ChartNode) => n.children?.forEach(c => childrenSet.add(c)));
    const functionalTypes = ['executive', 'manager', 'employee'];
    const roots = Array.from(map.values())
      .filter((n: ChartNode) => !childrenSet.has(n.id) && functionalTypes.includes(n.type));
    
    let rootX = 0;
    roots.forEach(root => {
        const w = measureSubtree(root.id);
        executeLayout(root.id, rootX, 0);
        rootX += w + GROUP_MARGIN + 200; 
    });

    // 2. Transfer non-hierarchy nodes (preserve old position initially)
    currentPositions.forEach((pos, id) => {
       const node = map.get(id);
       if (node && !functionalTypes.includes(node.type)) {
          newPositions.set(id, pos);
       }
    });

    // 3. Post-Process: Calculate Group/Area Boundaries
    const groups = Array.from(map.values()).filter(n => n.type === 'group');
    
    groups.forEach(group => {
       const members = Array.from(map.values()).filter((n: ChartNode) => 
           n.department === group.name && n.id !== group.id && functionalTypes.includes(n.type)
       );

       if (members.length > 0) {
          let minX = Infinity, minY = Infinity;
          let maxX = -Infinity, maxY = -Infinity;

          members.forEach((member: ChartNode) => {
             const pos = newPositions.get(member.id);
             if (pos) {
                const w = pos.width || 208;
                const h = pos.height || 100;
                if (pos.x < minX) minX = pos.x;
                if (pos.y < minY) minY = pos.y;
                if (pos.x + w > maxX) maxX = pos.x + w;
                if (pos.y + h > maxY) maxY = pos.y + h;
             }
          });

          if (minX !== Infinity) {
             const BOX_PADDING_SIDE = 100; 
             const BOX_PADDING_TOP = 100;
             const BOX_PADDING_BOTTOM = 140; 

             newPositions.set(group.id, {
                x: minX - BOX_PADDING_SIDE,
                y: minY - BOX_PADDING_TOP,
                width: (maxX - minX) + (BOX_PADDING_SIDE * 2),
                height: (maxY - minY) + BOX_PADDING_TOP + BOX_PADDING_BOTTOM
             });
          }
       }
    });
    
    // 4. Post-Process: Re-position anchored nodes (Text/Notes)
    // They must follow their parent group
    anchoredNodes.forEach((anchor, nodeId) => {
        const newGroupPos = newPositions.get(anchor.groupId);
        const currentNodePos = newPositions.get(nodeId); // currently holds old pos
        
        if (newGroupPos && currentNodePos) {
            newPositions.set(nodeId, {
                ...currentNodePos,
                x: newGroupPos.x + anchor.offsetX,
                y: newGroupPos.y + anchor.offsetY
            });
        }
    });

    this.nodePositions.set(newPositions);
  }

  // Helper to sort children so departments stay together
  private sortChildrenByDepartment(map: Map<string, ChartNode>) {
      map.forEach((node: ChartNode) => {
          if (node.children && node.children.length > 1) {
              node.children.sort((aId, bId) => {
                  const a = map.get(aId);
                  const b = map.get(bId);
                  const deptA = a?.department || '';
                  const deptB = b?.department || '';
                  
                  if (deptA === deptB) return 0;
                  return deptA > deptB ? 1 : -1;
              });
          }
      });
  }

  // --- Topology Actions ---

  linkNodes(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;

    // Check if link already exists
    const source = this.nodes().get(sourceId);
    if (source?.children?.includes(targetId)) return;

    // Check for cycles (A -> B -> A)
    if (this.isDescendant(targetId, sourceId)) {
      alert("Cannot connect: This would create a cycle.");
      return;
    }

    this.saveHistory();

    this.nodes.update(map => {
      const newMap = new Map<string, ChartNode>(map);
      const node = newMap.get(sourceId);
      if (node) {
        this.removeFromParent(newMap, targetId);
        const newChildren = [...(node.children || []), targetId];
        newMap.set(sourceId, { ...node, children: newChildren });
      }
      return newMap;
    });
  }

  unlinkEdge(sourceId: string, targetId: string) {
    this.nodes.update(map => {
      const newMap = new Map<string, ChartNode>(map);
      const node = newMap.get(sourceId);
      if (node && node.children) {
        newMap.set(sourceId, {
          ...node,
          children: node.children.filter(id => id !== targetId)
        });
      }
      return newMap;
    });
  }

  deleteSelectedEdge() {
    const edgeId = this.selectedEdgeId();
    if (!edgeId) return;

    const edge = this.edges().find(e => e.id === edgeId);
    
    if (edge) {
      this.saveHistory();
      this.unlinkEdge(edge.sourceId, edge.targetId);
      this.selectedEdgeId.set(null);
    }
  }

  private removeFromParent(map: Map<string, ChartNode>, childId: string) {
    map.forEach((node: ChartNode) => {
      if (node.children?.includes(childId)) {
        map.set(node.id, {
          ...node,
          children: node.children.filter(c => c !== childId)
        });
      }
    });
  }

  private isDescendant(rootId: string, searchId: string): boolean {
    const map = this.nodes();
    const node = map.get(rootId);
    if (!node || !node.children) return false;
    
    for (const childId of node.children) {
      if (childId === searchId) return true;
      if (this.isDescendant(childId, searchId)) return true;
    }
    return false;
  }

  // --- Node Actions ---

  updateNodePosition(id: string, x: number, y: number) {
    this.nodePositions.update(map => {
      const newMap = new Map<string, NodePosition>(map);
      const current = newMap.get(id);
      newMap.set(id, { ...current, x, y }); // Preserve width/height
      return newMap;
    });
  }
  
  moveSelectedDrawings(dx: number, dy: number) {
      const selectedIds = this.selectedDrawingIds();
      if (selectedIds.size === 0) return;

      this.drawings.update(list => list.map(d => {
          if (selectedIds.has(d.id)) {
              return { ...d, path: this.shiftPath(d.path, dx, dy) };
          }
          return d;
      }));
  }

  updateNodeDimensions(id: string, width: number, height: number) {
    this.nodePositions.update(map => {
      const newMap = new Map<string, NodePosition>(map);
      const current = newMap.get(id);
      if (current) {
        // Only update if changed to avoid signals loop
        if (Math.abs((current.width || 208) - width) > 1 || Math.abs((current.height || 100) - height) > 1) {
           newMap.set(id, { ...current, width, height });
        }
      } else {
         newMap.set(id, { x: 0, y: 0, width, height });
      }
      return newMap;
    });
  }

  selectNode(id: string, multi = false) {
    this.selectedEdgeId.set(null); 
    this.selectedNodeIds.update(current => {
      const newSet = multi ? new Set(current) : new Set<string>();
      if (multi && newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
    
    // Clear drawing selection when selecting nodes explicitly unless multi
    if (!multi) {
        this.selectedDrawingIds.set(new Set());
    }
  }
  
  selectDrawing(id: string, multi = false) {
      this.selectedEdgeId.set(null);
      this.selectedDrawingIds.update(current => {
          const newSet = multi ? new Set(current) : new Set<string>();
          if (multi && newSet.has(id)) {
              newSet.delete(id);
          } else {
              newSet.add(id);
          }
          return newSet;
      });
      
      // Clear node selection when selecting drawing explicitly unless multi
      if (!multi) {
          this.selectedNodeIds.set(new Set());
      }
  }

  selectAll() {
    const allNodeIds = new Set(this.nodes().keys());
    this.selectedNodeIds.set(allNodeIds);
    
    const allDrawingIds = new Set(this.drawings().map(d => d.id));
    this.selectedDrawingIds.set(allDrawingIds);
    
    this.selectedEdgeId.set(null);
  }

  selectEdge(id: string) {
    this.selectedNodeIds.set(new Set());
    this.selectedDrawingIds.set(new Set());
    this.selectedEdgeId.set(id);
  }

  clearSelection() {
    this.selectedNodeIds.set(new Set());
    this.selectedDrawingIds.set(new Set());
    this.selectedEdgeId.set(null);
  }

  updateNode(updatedNode: Partial<ChartNode>) {
    const currentIds = this.selectedNodeIds();
    if (currentIds.size === 0) return;

    const isRenaming = updatedNode.name !== undefined;

    this.nodes.update(map => {
      const newMap = new Map<string, ChartNode>(map);
      currentIds.forEach(id => {
        const node = newMap.get(id);
        if (node) {
          // Rename Propagation: If we rename a group, update all children who have this group as department
          if (node.type === 'group' && isRenaming && updatedNode.name && node.name !== updatedNode.name) {
             const oldName = node.name;
             const newName = updatedNode.name;
             
             // Scan all nodes to find members of this group
             newMap.forEach((otherNode: ChartNode) => {
                if (otherNode.department === oldName) {
                   newMap.set(otherNode.id, { ...otherNode, department: newName });
                }
             });
          }

          newMap.set(id, { ...node, ...updatedNode });
        }
      });
      return newMap;
    });
  }

  // Helper used to detect intersection area
  private getOverlapArea(r1: {x:number, y:number, w:number, h:number}, r2: {x:number, y:number, w:number, h:number}): number {
        const overlapLeft = Math.max(r1.x, r2.x);
        const overlapRight = Math.min(r1.x + r1.w, r2.x + r2.w);
        const overlapTop = Math.max(r1.y, r2.y);
        const overlapBottom = Math.min(r1.y + r1.h, r2.y + r2.h);

        if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
          return (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
        }
        return 0;
  }

  // Update group membership based on overlap (intersection)
  updateGroupMembership(groupId: string) {
      const nodes = this.nodes();
      const positions = this.nodePositions();
      
      const groupNode = nodes.get(groupId);
      const groupPos = positions.get(groupId);
      
      if (!groupNode || !groupPos || groupNode.type !== 'group') return;
      
      const gRect = {
        x: groupPos.x,
        y: groupPos.y,
        w: groupPos.width || 300,
        h: groupPos.height || 300
      };
      
      const functionalTypes = ['executive', 'manager', 'employee'];

      this.nodes.update(map => {
         const newMap = new Map<string, ChartNode>(map);
         
         newMap.forEach((node: ChartNode) => {
            if (functionalTypes.includes(node.type) && node.id !== groupId) {
               const pos = positions.get(node.id);
               if (pos) {
                   const nRect = {
                     x: pos.x,
                     y: pos.y,
                     w: pos.width || 208,
                     h: pos.height || 100
                   };

                   // Calculate Overlap
                   const overlap = this.getOverlapArea(gRect, nRect);
                   
                   // CASE 1: Node touches Group -> Adopt
                   if (overlap > 0) {
                      if (node.department !== groupNode.name) {
                          newMap.set(node.id, { ...node, department: groupNode.name });
                      }
                   } 
                   // CASE 2: Node NOT touching, but has this department -> Orphan
                   else if (node.department === groupNode.name) {
                      newMap.set(node.id, { ...node, department: '' });
                   }
               }
            }
         });
         return newMap;
      });
  }

  // Logic to update a single node's membership when dragged
  updateNodeMembership(nodeId: string) {
      const nodes = this.nodes();
      const positions = this.nodePositions();
      const node = nodes.get(nodeId);
      const pos = positions.get(nodeId);

      if (!node || !pos || !['executive', 'manager', 'employee'].includes(node.type)) return;

      const nRect = {
         x: pos.x,
         y: pos.y,
         w: pos.width || 208,
         h: pos.height || 100
      };

      let bestGroup: ChartNode | null = null;
      let maxOverlap = 0;

      // Find the group with maximum overlap
      nodes.forEach((gNode: ChartNode) => {
          if (gNode.type === 'group' && gNode.id !== nodeId) {
             const gPos = positions.get(gNode.id);
             if (gPos) {
                 const gRect = {
                    x: gPos.x,
                    y: gPos.y,
                    w: gPos.width || 300,
                    h: gPos.height || 300
                 };
                 const overlap = this.getOverlapArea(nRect, gRect);
                 if (overlap > maxOverlap) {
                    maxOverlap = overlap;
                    bestGroup = gNode;
                 }
             }
          }
      });

      this.nodes.update(map => {
         const newMap = new Map<string, ChartNode>(map);
         const currentNode = newMap.get(nodeId);
         if (!currentNode) return newMap; // Safety

         if (bestGroup) {
             if (currentNode.department !== (bestGroup as ChartNode).name) {
                 newMap.set(nodeId, { ...currentNode, department: (bestGroup as ChartNode).name });
             }
         } else {
             // If touching NO group, clear department (Stop touching = Eliminate name)
             if (currentNode.department) {
                 newMap.set(nodeId, { ...currentNode, department: '' });
             }
         }
         return newMap;
      });
  }

  deleteSelection() {
    const nodeIds = this.selectedNodeIds();
    const drawingIds = this.selectedDrawingIds();
    
    if (nodeIds.size === 0 && drawingIds.size === 0) return;

    this.saveHistory();

    // Delete Nodes
    if (nodeIds.size > 0) {
        this.nodes.update(map => {
          const newMap = new Map<string, ChartNode>(map);
          nodeIds.forEach(idToDelete => {
             this.removeFromParent(newMap, idToDelete);
             newMap.delete(idToDelete);
          });
          return newMap;
        });
    
        this.nodePositions.update(map => {
          const newMap = new Map<string, NodePosition>(map);
          nodeIds.forEach(id => newMap.delete(id));
          return newMap;
        });
    }

    // Delete Drawings
    if (drawingIds.size > 0) {
        this.drawings.update(list => list.filter(d => !drawingIds.has(d.id)));
    }
    
    this.selectedNodeIds.set(new Set());
    this.selectedDrawingIds.set(new Set());
  }
  
  // Specific method for the eraser
  deleteDrawing(id: string) {
      this.saveHistory();
      this.drawings.update(list => list.filter(d => d.id !== id));
      // Remove from selection if present
      this.selectedDrawingIds.update(s => {
          const n = new Set(s);
          n.delete(id);
          return n;
      });
  }

  deleteSelectedNode() {
      // Wrapper for backward compatibility or strict node deletion
      this.deleteSelection();
  }

  // --- Clipboard Logic ---

  copySelection() {
    const selectedNodes = this.selectedNodeIds();
    const selectedDrawings = this.selectedDrawingIds();
    
    if (selectedNodes.size === 0 && selectedDrawings.size === 0) return;

    const currentNodes = this.nodes();
    const currentPositions = this.nodePositions();
    const currentDrawings = this.drawings();
    
    this.clipboard = [];

    // Copy Nodes
    selectedNodes.forEach(id => {
      const node = currentNodes.get(id);
      const pos = currentPositions.get(id);
      if (node && pos) {
        this.clipboard.push({
          type: 'node',
          data: JSON.parse(JSON.stringify(node)),
          x: pos.x,
          y: pos.y,
          width: pos.width || 208,
          height: pos.height || 100
        });
      }
    });
    
    // Copy Drawings
    selectedDrawings.forEach(id => {
        const drawing = currentDrawings.find(d => d.id === id);
        if (drawing) {
            // Calculate bound for offset
            const bounds = this.getDrawingBounds(drawing.path);
            this.clipboard.push({
                type: 'drawing',
                data: JSON.parse(JSON.stringify(drawing)),
                x: bounds.x,
                y: bounds.y,
                width: bounds.w,
                height: bounds.h
            });
        }
    });
  }

  pasteNodes(targetX: number, targetY: number) {
    if (this.clipboard.length === 0) return;

    this.saveHistory();

    // 1. Calculate bounding box of clipboard items to center them at target
    let minX = Infinity, minY = Infinity;
    this.clipboard.forEach(item => {
      if (item.x < minX) minX = item.x;
      if (item.y < minY) minY = item.y;
    });

    // 2. Mapping of Old ID -> New ID to reconstruct relationships
    const idMap = new Map<string, string>();
    const newItems: { node: ChartNode, pos: NodePosition }[] = [];
    const newDrawings: Drawing[] = [];

    // First pass: Generate IDs and calculate positions
    this.clipboard.forEach(item => {
       const newId = Math.random().toString(36).substr(2, 9);
       
       const offsetX = item.x - minX;
       const offsetY = item.y - minY;
       
       if (item.type === 'node') {
           const nodeData = item.data as ChartNode;
           idMap.set(nodeData.id, newId);
           newItems.push({
              node: { ...nodeData, id: newId },
              pos: { 
                x: targetX + offsetX, 
                y: targetY + offsetY,
                width: item.width,
                height: item.height
              }
           });
       } else if (item.type === 'drawing') {
           const drawingData = item.data as Drawing;
           // For drawings, we need to shift the path data
           const shiftedPath = this.shiftPath(drawingData.path, (targetX + offsetX) - item.x, (targetY + offsetY) - item.y);
           newDrawings.push({
               ...drawingData,
               id: newId,
               path: shiftedPath
           });
       }
    });

    // Second pass: Fix relationships (children) for nodes
    newItems.forEach(item => {
       if (item.node.children && item.node.children.length > 0) {
          const newChildren: string[] = [];
          item.node.children.forEach(childId => {
             if (idMap.has(childId)) {
                newChildren.push(idMap.get(childId)!);
             }
          });
          item.node.children = newChildren;
       }
    });

    // 3. Commit to state
    if (newItems.length > 0) {
        this.nodes.update(map => {
          const newMap = new Map<string, ChartNode>(map);
          newItems.forEach(item => newMap.set(item.node.id, item.node));
          return newMap;
        });
    
        this.nodePositions.update(map => {
          const newMap = new Map<string, NodePosition>(map);
          newItems.forEach(item => newMap.set(item.node.id, item.pos));
          return newMap;
        });
    }

    if (newDrawings.length > 0) {
        this.drawings.update(d => [...d, ...newDrawings]);
    }

    // 4. Select the newly pasted items
    const newNodeSelection = new Set<string>();
    newItems.forEach(item => newNodeSelection.add(item.node.id));
    this.selectedNodeIds.set(newNodeSelection);
    
    const newDrawingSelection = new Set<string>();
    newDrawings.forEach(d => newDrawingSelection.add(d.id));
    this.selectedDrawingIds.set(newDrawingSelection);
    
    // 5. Check group memberships for pasted items
    newItems.forEach(item => {
        if (item.node.type === 'group') {
            this.updateGroupMembership(item.node.id);
        }
    });
  }

  importFromJson(data: any) {
    // Basic validation
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.positions)) {
      alert('Invalid JSON format for import.');
      throw new Error('Invalid JSON format for import.');
    }

    this.saveHistory(); // Save current state so import can be undone

    try {
      // Convert arrays back to Maps
      const newNodes = new Map<string, ChartNode>(data.nodes);
      const newPositions = new Map<string, NodePosition>(data.positions);
      // drawings can be optional in older exports, so handle that
      const newDrawings = Array.isArray(data.drawings) ? data.drawings : [];

      this.nodes.set(newNodes);
      this.nodePositions.set(newPositions);
      this.drawings.set(newDrawings);

      this.clearSelection();
    } catch(error) {
        console.error('Error processing imported JSON data:', error);
        alert('Could not apply the data from the JSON file. The data may be invalid.');
        // If processing fails, revert to the previous state by undoing.
        this.undo();
        // The undo operation pushes the failed state to the redo stack, which is confusing.
        // Clear the redo stack to prevent users from redoing a failed import.
        this.redoStack = [];
    }
  }

  // Helper to shift SVG path
  private shiftPath(path: string, dx: number, dy: number): string {
    // Regex to find SVG path commands and their parameters
    const commandRegex = /([a-zA-Z])([^a-zA-Z]*)/g;
    let newPath = '';
    let match;

    // This ensures that even if path is null or undefined, it doesn't crash.
    const pathString = path || '';

    while ((match = commandRegex.exec(pathString)) !== null) {
      const command = match[1];
      const params = match[2].trim();
      
      newPath += command + ' ';

      if (params) {
        // Split parameters by space or comma, and filter out empty strings
        const coords = params.split(/[ ,]+/).filter(Boolean);
        
        const newCoords = coords.map((coord, index) => {
          const val = parseFloat(coord);
          if (isNaN(val)) return ''; // Should be filtered out but as a safeguard
          
          // Even index is X, odd is Y
          const newVal = val + (index % 2 === 0 ? dx : dy);
          return (Math.round(newVal * 100) / 100).toString();
        });

        newPath += newCoords.join(' ') + ' ';
      }
    }
    return newPath.trim();
  }
  
  // Helper to parse bounds of a path
  getDrawingBounds(d: string): {x: number, y: number, w: number, h: number} {
      const numbers = d.match(/[-+]?[0-9]*\.?[0-9]+/g)?.map(Number) || [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      for(let i=0; i<numbers.length; i+=2) {
          const x = numbers[i];
          const y = numbers[i+1];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
      }
      
      if (minX === Infinity) return {x:0, y:0, w:0, h:0};
      
      return {
          x: minX,
          y: minY,
          w: maxX - minX,
          h: maxY - minY
      };
  }

  // Generic add node used by different tools
  addNode(type: ChartNode['type'], x: number, y: number, options: Partial<ChartNode> = {}, dimensions?: {width: number, height: number}): string {
    this.saveHistory();

    const newNode: ChartNode = {
      id: Math.random().toString(36).substr(2, 9),
      name: type === 'note' ? 'New Note' : (type === 'shape' ? 'New Shape' : (type === 'group' ? 'New Area' : (type === 'text' ? 'Type text...' : 'New Role'))),
      role: type === 'note' || type === 'shape' || type === 'group' || type === 'text' ? '' : 'Position',
      type: type,
      level: type === 'executive' || type === 'manager' || type === 'employee' ? 'P0 - Egresado' : undefined,
      children: [],
      avatarType: 'icon',
      avatarIcon: 'person',
      backgroundColor: type === 'group' || type === 'text' ? 'transparent' : '#ffffff',
      borderColor: '#cbd5e1',
      borderWidth: type === 'group' ? 2 : (type === 'text' ? 0 : 2),
      nameColor: type === 'group' ? '#64748b' : '#0f172a',
      roleColor: '#475569',
      departmentColor: '#64748b',
      shapeType: 'rectangle',
      borderRadius: 8,
      fontSize: 14,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      ...options
    };

    // Default sizes for logic calculation
    let width = dimensions?.width || 208;
    let height = dimensions?.height || 100;
    
    if (!dimensions) {
      if (type === 'note') { width = 200; height = 200; }
      if (type === 'shape') { width = 150; height = 150; }
      if (type === 'group') { width = 300; height = 300; }
      if (type === 'text') { width = 150; height = 50; }
    }

    this.nodes.update(map => {
       const newMap = new Map<string, ChartNode>(map);
       newMap.set(newNode.id, newNode);
       return newMap;
    });

    this.nodePositions.update(map => {
      const newMap = new Map<string, NodePosition>(map);
      newMap.set(newNode.id, { x, y, width, height });
      return newMap;
    });
    
    // Check memberships immediately upon creation of a group
    if (type === 'group') {
        this.updateGroupMembership(newNode.id);
    }

    return newNode.id;
  }

  addMember() {
    this.saveHistory();

    const currentIds = this.selectedNodeIds();
    const positions = this.nodePositions();
    let parentId: string | null = null;

    if (currentIds.size > 0) {
      const idsArray = Array.from(currentIds);
      parentId = idsArray[idsArray.length - 1];
    }

    let newX = 100;
    let newY = 100;

    if (parentId) {
      const parentNode = this.nodes().get(parentId);
      const parentPos = positions.get(parentId);
      
      if (parentPos) {
         const siblingsCount = parentNode?.children?.length || 0;
         const spacing = 240; 
         newX = parentPos.x + (siblingsCount * spacing); 
         newY = parentPos.y + 180;
      }
    } else {
      let maxX = 0;
      if (positions.size > 0) {
        positions.forEach(p => {
          if (p.x > maxX) maxX = p.x;
        });
        newX = maxX + 250;
        newY = 100;
      }
    }

    const newId = this.addNode('employee', newX, newY);
    
    // Link if parent exists
    if (parentId) {
      this.nodes.update(map => {
        const newMap = new Map<string, ChartNode>(map);
        const parent = newMap.get(parentId!);
        if (parent) {
          newMap.set(parentId!, { ...parent, children: [...(parent.children || []), newId]});
        }
        return newMap;
      });
    }

    this.selectedNodeIds.set(new Set([newId]));
  }

  // --- Drawing Actions ---
  addDrawing(drawing: Drawing) {
    this.saveHistory();
    this.drawings.update(d => [...d, drawing]);
  }

  clearDrawings() {
    this.saveHistory();
    this.drawings.set([]);
  }

  updatePan(dx: number, dy: number) {
    this.panOffset.update(current => ({
      x: current.x + dx,
      y: current.y + dy
    }));
  }

  zoomToFit(containerWidth: number, containerHeight: number) {
    const positions = this.nodePositions();
    const drawings = this.drawings();

    if (positions.size === 0 && drawings.length === 0) {
      this.panOffset.set({x: 0, y: 0});
      this.zoomLevel.set(100);
      return;
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    // 1. Calculate bounds for nodes
    positions.forEach(pos => {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      const w = pos.width || 208;
      const h = pos.height || 100;
      if (pos.x + w > maxX) maxX = pos.x + w;
      if (pos.y + h > maxY) maxY = pos.y + h;
    });

    // 2. Calculate bounds for drawings
    drawings.forEach(d => {
       const b = this.getDrawingBounds(d.path);
       if (b.w > 0) {
           if (b.x < minX) minX = b.x;
           if (b.y < minY) minY = b.y;
           if (b.x + b.w > maxX) maxX = b.x + b.w;
           if (b.y + b.h > maxY) maxY = b.y + b.h;
       }
    });

    if (minX === Infinity) {
      this.panOffset.set({x: 0, y: 0});
      this.zoomLevel.set(100);
      return;
    }

    const padding = 100;
    const contentW = (maxX - minX) + (padding * 2);
    const contentH = (maxY - minY) + (padding * 2);

    const scaleX = containerWidth / contentW;
    const scaleY = containerHeight / contentH;
    
    // Fit to screen
    let newScale = Math.min(scaleX, scaleY);
    
    // Upper bound cap at 150% to prevent single items being massive
    if (newScale > 1.5) newScale = 1.5;
    
    // Calculate percentage, ensuring it's at least 1%
    let zoomPercentage = Math.floor(newScale * 100);
    if (zoomPercentage < 1) zoomPercentage = 1;
    
    this.zoomLevel.set(zoomPercentage);

    // Center the content
    const finalScale = zoomPercentage / 100;
    
    const contentCenterX = minX + (maxX - minX) / 2;
    const contentCenterY = minY + (maxY - minY) / 2;

    const newPanX = (containerWidth / 2) - (contentCenterX * finalScale);
    const newPanY = (containerHeight / 2) - (contentCenterY * finalScale);

    this.panOffset.set({ x: newPanX, y: newPanY });
  }
}
