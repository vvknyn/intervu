import { getFirebaseDb } from '@/lib/firebase/config';
import { collection, query, orderBy, getDocs, addDoc } from 'firebase/firestore';

export interface Story {
    id: string;
    created_at: string;
    title: string;
    content: string;
    user_id?: string;
    deleted?: boolean;
}

export async function getStories(): Promise<Story[]> {
    try {
        const db = getFirebaseDb();
        const q = query(collection(db, 'stories'), orderBy('created_at', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
    } catch (error) {
        console.error('Error fetching stories:', error);
        return [];
    }
}

export async function createStory(story: { title: string; content: string }) {
    try {
        const db = getFirebaseDb();
        const docRef = await addDoc(collection(db, 'stories'), {
            ...story,
            created_at: new Date().toISOString()
        });
        return [{ id: docRef.id, ...story, created_at: new Date().toISOString() }];
    } catch (error) {
        console.error('Error creating story:', error);
        return null;
    }
}
