import type { DragEvent } from 'react'
import type { DropPosition } from '@shared/sidebarTree'

/** One MIME type per kind of draggable thing, so drop targets only react to what they accept. */
export const TASK_MIME = 'application/x-todo-task'
export const LIST_MIME = 'application/x-todo-list'
export const FOLDER_MIME = 'application/x-todo-folder'

export function dragHasType(e: DragEvent, mime: string): boolean {
  return e.dataTransfer.types.includes(mime)
}

/**
 * Props that make an element a drop target for one MIME type. `onActiveChange` drives the highlight;
 * `onDropId` receives the dragged item's id.
 */
export function dropTargetProps(mime: string, onActiveChange: (active: boolean) => void, onDropId: (id: string) => void) {
  return {
    onDragOver: (e: DragEvent) => {
      if (!dragHasType(e, mime)) return
      e.preventDefault()
      // Targets can be nested (a folder inside the list area); the innermost one handles the drag.
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      onActiveChange(true)
    },
    onDragLeave: (e: DragEvent) => {
      // Ignore leave events fired when moving between the target's own children.
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
      onActiveChange(false)
    },
    onDrop: (e: DragEvent) => {
      if (!dragHasType(e, mime)) return
      e.preventDefault()
      e.stopPropagation()
      onActiveChange(false)
      const id = e.dataTransfer.getData(mime)
      if (id) onDropId(id)
    }
  }
}

/** The sidebar entries that can be dragged to reorder them. */
export type SortKind = 'list' | 'folder'
const SORT_MIME: Record<SortKind, string> = { list: LIST_MIME, folder: FOLDER_MIME }

export function startSortDrag(e: DragEvent, kind: SortKind, id: string): void {
  e.stopPropagation()
  e.dataTransfer.setData(SORT_MIME[kind], id)
  e.dataTransfer.effectAllowed = 'move'
}

function draggedSortKind(e: DragEvent): SortKind | null {
  return dragHasType(e, LIST_MIME) ? 'list' : dragHasType(e, FOLDER_MIME) ? 'folder' : null
}

/**
 * Props that make an element a drop target for sidebar reordering. `resolve` maps the dragged kind and the
 * pointer's height within the element (0 = top edge, 1 = bottom edge) to a drop position, or returns null to
 * refuse that kind here, letting the event bubble to an outer target. `onIndicator` drives the insertion line.
 */
export function sortDropProps(
  resolve: (kind: SortKind, y: number) => DropPosition | null,
  onIndicator: (position: DropPosition | null) => void,
  onDrop: (kind: SortKind, id: string, position: DropPosition) => void
) {
  const positionFor = (e: DragEvent) => {
    const kind = draggedSortKind(e)
    if (!kind) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const position = resolve(kind, (e.clientY - rect.top) / rect.height)
    return position && { kind, position }
  }
  return {
    onDragOver: (e: DragEvent) => {
      const hit = positionFor(e)
      if (!hit) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      onIndicator(hit.position)
    },
    onDragLeave: (e: DragEvent) => {
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
      onIndicator(null)
    },
    onDrop: (e: DragEvent) => {
      const hit = positionFor(e)
      if (!hit) return
      e.preventDefault()
      e.stopPropagation()
      onIndicator(null)
      const id = e.dataTransfer.getData(SORT_MIME[hit.kind])
      if (id) onDrop(hit.kind, id, hit.position)
    }
  }
}

type DropHandlers = ReturnType<typeof dropTargetProps>

/** Lets one element be a drop target for several MIME types; each handler ignores types it doesn't accept. */
export function mergeDropProps(...handlers: DropHandlers[]): DropHandlers {
  return {
    onDragOver: (e) => handlers.forEach((h) => h.onDragOver(e)),
    onDragLeave: (e) => handlers.forEach((h) => h.onDragLeave(e)),
    onDrop: (e) => handlers.forEach((h) => h.onDrop(e))
  }
}
