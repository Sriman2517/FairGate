import Image from "next/image";

export function MoviePoster({ title, path, priority = false }: { title: string; path?: string | null; priority?: boolean }) {
  return <div className="poster-frame">{path
    ? <Image src={path} alt={`${title} movie poster`} fill sizes="(max-width: 600px) 85vw, (max-width: 900px) 45vw, 350px" preload={priority} />
    : <div className="poster-fallback"><span aria-hidden="true">✦</span><span>{title}</span></div>}
  </div>;
}
