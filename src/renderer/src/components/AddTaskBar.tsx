import { useState, type FormEvent } from 'react'
import { useAppState } from '../state/AppStateContext'

export function AddTaskBar({ listId, starred = false }: { listId: string; starred?: boolean }) {
  const { addTask } = useAppState()
  const [title, setTitle] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    await addTask({ title, listId, starred })
    setTitle('')
  }

  return (
    <form className="add-task-bar" onSubmit={handleSubmit}>
      <span className="add-task-plus">+</span>
      <input
        type="text"
        placeholder={starred ? 'Add an important task' : 'Add a task'}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  )
}
