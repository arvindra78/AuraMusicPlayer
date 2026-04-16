import os
import sys
import tempfile
from flask import Flask, render_template, jsonify, send_from_directory, Response, request

try:
    from mutagen.id3 import ID3, APIC
    from mutagen.flac import FLAC
    from mutagen.mp4 import MP4
    MUTAGEN_OK = True
except ImportError:
    MUTAGEN_OK = False

# PyInstaller: when frozen, templates/static are in sys._MEIPASS
if getattr(sys, 'frozen', False):
    _base = sys._MEIPASS
else:
    _base = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__,
    template_folder=os.path.join(_base, 'templates'),
    static_folder=os.path.join(_base, 'static'),
)

# Configure the music directory based on user input.
MUSIC_DIR = r"D:\LocalSongs"
if not os.path.exists(MUSIC_DIR):
    os.makedirs(MUSIC_DIR, exist_ok=True)


@app.route('/')
def index():
    print('>>> AURA MUSIC PLAYER 3.0: Serving index.html <<<')
    return render_template('index.html')

@app.route('/api/songs')
def get_songs():
    """Recursively scan for audio files and return their relative paths."""
    supported_extensions = {'.mp3', '.flac', '.wav', '.m4a', '.ogg'}
    songs = []
    
    for root, dirs, files in os.walk(MUSIC_DIR):
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in supported_extensions:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, MUSIC_DIR)
                # Convert Windows paths to POSIX paths for URLs
                rel_path = rel_path.replace("\\", "/")
                songs.append({
                    "url": f"/music/{rel_path}",
                    "filename": file
                })
                
    return jsonify(songs)


# ─── Album Art API (unified logic) ────────────────────────────────────────────
AUDIO_EXTS = {'.mp3', '.flac', '.m4a', '.mp4', '.aac', '.ogg'}


def _extract_metadata_from_file(filepath):
    """Extract embedded metadata and art from an audio file. Returns (dict, bytes, mime)."""
    metadata = {
        "title": os.path.splitext(os.path.basename(filepath))[0],
        "artist": "Unknown Artist",
        "album": "Unknown Album",
        "year": ""
    }
    art_data = None
    mime = 'image/jpeg'
    
    if not MUTAGEN_OK:
        return metadata, None, None

    ext = os.path.splitext(filepath)[1].lower()
    try:
        if ext == '.mp3':
            tags = ID3(filepath)
            metadata["title"] = str(tags.get('TIT2', metadata["title"]))
            metadata["artist"] = str(tags.get('TPE1', metadata["artist"]))
            metadata["album"] = str(tags.get('TALB', metadata["album"]))
            metadata["year"] = str(tags.get('TDRC', tags.get('TYER', "")))
            
            for tag in tags.values():
                if isinstance(tag, APIC):
                    art_data = tag.data
                    mime = tag.mime or 'image/jpeg'
                    break
        elif ext == '.flac':
            flac = FLAC(filepath)
            metadata["title"] = flac.get('title', [metadata["title"]])[0]
            metadata["artist"] = flac.get('artist', [metadata["artist"]])[0]
            metadata["album"] = flac.get('album', [metadata["album"]])[0]
            metadata["year"] = flac.get('date', [""])[0]
            
            if flac.pictures:
                pic = flac.pictures[0]
                art_data = pic.data
                mime = pic.mime or 'image/jpeg'
        elif ext in ('.m4a', '.mp4', '.aac'):
            mp4 = MP4(filepath)
            if mp4.tags:
                metadata["title"] = mp4.tags.get('\xa9nam', [metadata["title"]])[0]
                metadata["artist"] = mp4.tags.get('\xa9ART', [metadata["artist"]])[0]
                metadata["album"] = mp4.tags.get('\xa9alb', [metadata["album"]])[0]
                metadata["year"] = mp4.tags.get('\xa9day', [""])[0]
                
                covers = mp4.tags.get('covr', [])
                if covers:
                    art_data = bytes(covers[0])
    except Exception as e:
        print(f'[Metadata] Error extracting from {filepath}: {e}')
        
    return metadata, art_data, mime if art_data else None


def _extract_art_from_file(filepath):
    """Legacy helper for art-only endpoints."""
    _, art_data, mime = _extract_metadata_from_file(filepath)
    return art_data, mime


@app.route('/api/art', methods=['POST'])
def art_from_upload():
    """Extract art from uploaded file (for folder-added tracks). Receives multipart file."""
    print('[Art] POST /api/art received')
    if not MUTAGEN_OK:
        print('[Art] FAIL: Mutagen not available')
        return '', 404
    f = request.files.get('file')
    if not f:
        print('[Art] FAIL: No "file" in request.files', list(request.files.keys()))
        return '', 400
    if not f.filename:
        print('[Art] FAIL: File has no filename')
        return '', 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in AUDIO_EXTS:
        print('[Art] FAIL: Invalid ext', ext)
        return '', 400
    print('[Art] Processing file:', f.filename, 'content_length:', f.content_length)
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=ext)
        os.close(fd)
        f.save(tmp)
        size = os.path.getsize(tmp)
        print('[Art] Saved to temp, size:', size)
        art_data, mime = _extract_art_from_file(tmp)
        if art_data:
            print('[Art] OK: Extracted', len(art_data), 'bytes')
            return Response(art_data, mimetype=mime or 'image/jpeg')
        print('[Art] FAIL: No embedded art found in file')
    except Exception as e:
        print('[Art] FAIL: Exception', type(e).__name__, str(e))
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except Exception:
                pass
    return '', 404


@app.route('/api/art/<path:filename>')
def art_from_library(filename):
    """Extract art from default MUSIC_DIR (server library)."""
    filepath = os.path.join(MUSIC_DIR, filename.replace('/', os.sep))
    if not os.path.isfile(filepath):
        return '', 404
    art_data, mime = _extract_art_from_file(filepath)
    if art_data:
        return Response(art_data, mimetype=mime or 'image/jpeg')
    return '', 404


@app.route('/api/art-by-path')
def art_from_path():
    """Extract art from absolute path (for 'Open with' / external files)."""
    raw = request.args.get('path')
    if not raw:
        print('[Art] /api/art-by-path FAIL: No path provided')
        return '', 400
    filepath = os.path.normpath(raw.replace('/', os.sep))
    print(f'[Art] /api/art-by-path requested for: {filepath}')
    
    if not os.path.isabs(filepath) or not os.path.isfile(filepath):
        print(f'[Art] /api/art-by-path FAIL: Not an absolute file: {filepath}')
        return '', 404
    if os.path.splitext(filepath)[1].lower() not in AUDIO_EXTS:
        print(f'[Art] /api/art-by-path FAIL: Invalid extension: {filepath}')
        return '', 400
    
    art_data, mime = _extract_art_from_file(filepath)
    if art_data:
        print(f'[Art] /api/art-by-path OK: Extracted {len(art_data)} bytes')
        return Response(art_data, mimetype=mime or 'image/jpeg')
    
    print(f'[Art] /api/art-by-path FAIL: No art found in {filepath}')
    return '', 404

@app.route('/music/<path:filename>')
def serve_music(filename):
    """Serve the audio files from the music directory."""
    return send_from_directory(MUSIC_DIR, filename)


@app.route('/api/serve-file')
def serve_file_by_path():
    """Serve an audio file by absolute path (for 'Open with' / file association)."""
    import flask
    filepath = flask.request.args.get('path')
    if not filepath or not os.path.isabs(filepath):
        return '', 400
    if not os.path.exists(filepath) or not os.path.isfile(filepath):
        return '', 404
    ext = os.path.splitext(filepath)[1].lower()
    if ext not in {'.mp3', '.flac', '.wav', '.m4a', '.ogg'}:
        return '', 400
    try:
        return send_from_directory(os.path.dirname(filepath), os.path.basename(filepath), as_attachment=False)
    except Exception:
        return '', 500

if __name__ == '__main__':
    debug = os.environ.get('FLASK_ENV') == 'development'
    port = int(os.environ.get('FLASK_PORT', 5000))
    app.run(host='127.0.0.1', port=port, debug=debug)
