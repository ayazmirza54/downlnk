# downlnk

Saving a video off the internet these days sucks. One site wants you to install an app. The next "free downloader" is a minefield of fake buttons, and the one that works caps you at 480p and stamps a watermark on it. Plain files aren't much better: a 4 GB download crawls along on one connection and starts over from zero the moment your Wi-Fi blinks.

downlnk is a download manager that lives in your terminal, with zero setup and nothing to configure. Paste a link from YouTube, Instagram, Facebook, Reddit, X, TikTok or a thousand other sites, or any plain file, and it comes down to your computer at full speed. The files are yours, sorted into your downloads folder.

## Get started

1. **Install Node** (from [nodejs.org](https://nodejs.org)), it's all downlnk needs.
2. **Open your terminal.**
3. **Start it:**

   ```sh
   npx downlnk
   ```

That's the only thing you'll type. downlnk opens to a single box: paste a link (or a whole list of them) and press Enter. From there it's all keypresses, and `?` shows every one of them.

The first time you paste a video link, downlnk fetches the official [yt-dlp](https://github.com/yt-dlp/yt-dlp) build for your machine, and [gallery-dl](https://github.com/mikf/gallery-dl) the first time you paste a gallery. If you already have working copies installed, it uses those instead. Install [ffmpeg](https://ffmpeg.org) too if you can (`winget install Gyan.FFmpeg`, `brew install ffmpeg`, `sudo apt install ffmpeg`): it's what joins HD video to its sound and turns videos into MP3s. Without it, downlnk still works but sticks to formats that come as a single file.

## Adding something

Paste a link and downlnk works out what's behind it. For a video you get a picker: best quality, a specific resolution, or just the audio as MP3 or M4A. Toggle subtitles with `s`, switch MP4 / MKV with `m`, and for a playlist choose the whole thing or only the one video with `p`. Press Enter to download, or `f` to send it to a different folder.

A plain file skips the questions: you see its name, its size and whether the server lets downlnk split it up. Image posts, albums and boards go to gallery-dl and arrive as a folder of images.

Paste several links at once, or the path of a text file with one link per line, and they all go in at your default quality. Turn on clipboard watching with `w` and every supported link you copy gets offered to you: press `v` to take it.

## How it downloads

Plain files download the way IDM does it: up to 8 connections (`[` and `]` change that), each fetching its own piece of the file. When one finishes early, it splits the biggest piece still going and takes the back half, so every connection stays busy to the very end. Streaming sites get the same treatment through yt-dlp, which fetches several video fragments at once.

Everything resumes. Pause with `p`, quit with `q`, lose your connection or shut the laptop: the bytes already on disk stay there, and the download picks up where it stopped. Before resuming, downlnk checks that the server still has the same file, so a changed file starts fresh instead of ending up corrupt.

Finished downloads sort themselves IDM style into Video, Music, Images, Documents, Archives, Programs and Other inside your download folder. `T` turns sorting off, and `o` changes the folder. The sidebar filters the list the same way.

## Your downloads

Active downloads sit up top with their progress, speed, connections and time left; finished ones drop into Recently downloaded below. Space marks several so `p` or `x` acts on all of them at once. `P` pauses or resumes everything, `e` opens a download's folder, and `r` retries a failed one or grabs a finished one again.

| Key | What it does |
| --- | --- |
| `+` `-` | How many downloads run at once |
| `L` | Global speed limit, e.g. `2M`, shared by everything |
| `l` | Speed limit for one download |
| `S` | Schedule: `02:00-07:00` starts the queue at 2 and pauses it at 7 |
| `c` | Borrow your browser's sign-in for sites that need one |
| `t` | Next color theme |

## Themes

Press `t` to cycle through the color themes; downlnk remembers the one you land on. There's **torlink** (the default purple), **ocean**, **ember**, **forest**, **rose**, **mono**, and **paper** for terminals with a light background. To start with one directly:

    npx downlnk --theme ocean

## Signed-in content

Instagram, Facebook, Reddit and X show logged-out visitors less and less. If a link fails with a sign-in message, press `c` to choose the browser you're logged in with, and downlnk reads that browser's cookies on your machine for that site. It never asks for, stores or sends your password. Only download what you have the right to: downlnk doesn't get around DRM or paywalls.

## Headless

downlnk also runs without the TUI, for scripts and servers:

    downlnk get <url…> [-q 1080] [--audio mp3] [-o dir] [--limit 2M]
                            download with live progress, print the saved paths, exit
    downlnk info <url>      print what's behind a link (formats, size, files) as JSON
    downlnk queue add <url…>
    downlnk queue list      the saved queue, as JSON
    downlnk queue start     run the saved queue until it's empty
    downlnk tools           which yt-dlp / gallery-dl / ffmpeg it's using
    downlnk update-tools    fetch the newest yt-dlp and gallery-dl

Stop a `get` with Ctrl-C and run the same command again to resume. `downlnk --help` has every flag.

## Contributing

```sh
npm install
npm run dev        # run from source
npm test           # vitest
npm run typecheck
npm run build      # bundle to dist/, then: node dist/cli.cjs
npm link           # put a `downlnk` command on your PATH that runs this checkout
```

Set `DOWNLNK_STATE_DIR` to keep the queue, settings and fetched tools in a folder of your choosing instead of your user data folder.

## Credits

downlnk's look (its palette, panels, progress-bar sheen and text field) comes from [torlink](https://git.bairon.dev/baairon/torlink), MIT licensed. Media extraction is [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [gallery-dl](https://github.com/mikf/gallery-dl), run as separate programs.
