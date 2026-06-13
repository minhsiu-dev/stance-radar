export function ChannelAvatar({ title, thumbnail }: { title: string; thumbnail: string }) {
  if (!thumbnail) {
    return (
      <span
        title={title}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase"
      >
        {title.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbnail}
      alt={title}
      title={title}
      className="h-7 w-7 rounded-full object-cover"
    />
  );
}
