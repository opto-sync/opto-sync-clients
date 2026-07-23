#include <napi.h>
#include "syncer.h"
#include <string.h>
#include <stdlib.h>

// Global reference for the JS callback
Napi::FunctionReference g_callback;

char* cpp_override_cb(const char* key, const char* v1, const char* v2) {
    if (g_callback.IsEmpty()) return nullptr;

    Napi::Env env = g_callback.Env();
    Napi::HandleScope scope(env);

    napi_value args[3] = {
        Napi::String::New(env, key),
        Napi::String::New(env, v1),
        Napi::String::New(env, v2)
    };

    Napi::Value res = g_callback.Call({args[0], args[1], args[2]});
    if (res.IsString()) {
        std::string str = res.As<Napi::String>().Utf8Value();
        return strdup(str.c_str());
    }
    
    return nullptr;
}

Napi::Value MergeJsonNode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string j1 = info[0].As<Napi::String>().Utf8Value();
    std::string j2 = info[1].As<Napi::String>().Utf8Value();

    syncer_merge_override_cb cb = nullptr;

    if (info.Length() >= 3 && info[2].IsFunction()) {
        g_callback.Reset(info[2].As<Napi::Function>(), 1);
        cb = cpp_override_cb;
    }

    char* result = syncer_merge_json(j1.c_str(), j2.c_str(), cb);

    g_callback.Reset(); // free the reference

    if (!result) {
        return env.Null();
    }

    Napi::String ret = Napi::String::New(env, result);
    syncer_free(result);
    return ret;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "mergeJson"), Napi::Function::New(env, MergeJsonNode));
    return exports;
}

NODE_API_MODULE(syncer, Init)
