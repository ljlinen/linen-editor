package com.linen.editor;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "Saf")
public class SafPlugin extends Plugin {
  private static final int RW = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

  @PluginMethod public void pickFolder(PluginCall c) {
    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    i.addFlags(RW | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(c, i, "picked");
  }

  @ActivityCallback private void picked(PluginCall c, ActivityResult r) {
    if (c == null) return;
    if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null) { c.reject("cancelled"); return; }
    Uri u = r.getData().getData();
    getContext().getContentResolver().takePersistableUriPermission(u, RW);
    JSObject o = new JSObject(); o.put("uri", u.toString()); c.resolve(o);
  }

  @PluginMethod public void list(PluginCall c) {
    DocumentFile d = DocumentFile.fromTreeUri(getContext(), Uri.parse(c.getString("uri")));
    if (d == null) { c.reject("not accessible"); return; }
    JSArray a = new JSArray();
    for (DocumentFile f : d.listFiles()) {
      JSObject o = new JSObject();
      o.put("name", f.getName()); o.put("uri", f.getUri().toString()); o.put("isDir", f.isDirectory());
      a.put(o);
    }
    JSObject r = new JSObject(); r.put("entries", a); c.resolve(r);
  }

  @PluginMethod public void read(PluginCall c) {
    try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(c.getString("uri")))) {
      ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n;
      while ((n = in.read(buf)) != -1) b.write(buf, 0, n);
      JSObject o = new JSObject(); o.put("text", b.toString("UTF-8")); c.resolve(o);
    } catch (Exception e) { c.reject(String.valueOf(e.getMessage())); }
  }

  @PluginMethod public void readBase64(PluginCall c) {
    try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(c.getString("uri")))) {
      ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n;
      while ((n = in.read(buf)) != -1) b.write(buf, 0, n);
      JSObject o = new JSObject(); o.put("data", android.util.Base64.encodeToString(b.toByteArray(), android.util.Base64.NO_WRAP)); c.resolve(o);
    } catch (Exception e) { c.reject(String.valueOf(e.getMessage())); }
  }

  @PluginMethod public void write(PluginCall c) {
    try (OutputStream out = getContext().getContentResolver().openOutputStream(Uri.parse(c.getString("uri")), "wt")) {
      out.write(c.getString("text").getBytes(StandardCharsets.UTF_8)); c.resolve();
    } catch (Exception e) { c.reject(String.valueOf(e.getMessage())); }
  }
}
