export interface NewsPost { slug: string; title: string; date: string; summary: string; draft: boolean; body: string }
export function parseNewsPost(path: string, source: string): NewsPost
export function collectNewsPosts(files: Record<string, string>): NewsPost[]
export function formatNewsDate(date: string): string
