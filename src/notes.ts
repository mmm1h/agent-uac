import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const NOTES_DIR = path.join(os.homedir(), ".uac");
const NOTES_FILE = path.join(NOTES_DIR, "notes.json");

export function loadNotes(): Record<string, string> {
    try {
        if (!fs.existsSync(NOTES_FILE)) {
            return {};
        }
        const raw = fs.readFileSync(NOTES_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return {};
        }
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string") {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

export function saveNotes(notes: Record<string, string>): void {
    if (!fs.existsSync(NOTES_DIR)) {
        fs.mkdirSync(NOTES_DIR, { recursive: true });
    }
    fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), "utf-8");
}

export function getNote(serverId: string): string {
    const notes = loadNotes();
    return notes[serverId] ?? "";
}

export function setNote(serverId: string, note: string): void {
    const notes = loadNotes();
    if (note.trim() === "") {
        delete notes[serverId];
    } else {
        notes[serverId] = note;
    }
    saveNotes(notes);
}
