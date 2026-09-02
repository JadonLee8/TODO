import { useState, type FormEvent } from 'react'
import { useAppState } from '../state/AppStateContext'

export function AddTaskBar({ listId }: { listId: string }) {
  const { addTask } = useAppState()
  const [title, setTitle] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    await addTask({ title, listId })
    setTitle('')
  }

  return (
    <form className="add-task-bar" onSubmit={handleSubmit}>
      <span className="add-task-plus">+</span>
      <input
        type="text"
        placeholder="Add a task"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  )
}
