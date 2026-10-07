import type { DragEvent } from 'react'

/** One MIME type per kind of draggable thing, so drop targets only react to what they accept. */
export const TASK_MIME = 'application/x-todo-task'

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
      onActiveChange(false)
      const id = e.dataTransfer.getData(mime)
      if (id) onDropId(id)
    }
  }
}
