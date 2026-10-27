import { useParams } from 'react-router-dom';
import { NotesBrowser } from './NotesBrowser';
export function NotesPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <NotesBrowser spaceId={id} /> : null;
}
export default NotesPage;
