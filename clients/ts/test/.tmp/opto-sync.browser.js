"use strict";
var OptoSync = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // node_modules/dexie/dist/dexie.js
  var require_dexie = __commonJS({
    "node_modules/dexie/dist/dexie.js"(exports, module) {
      (function(global2, factory) {
        typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : typeof define === "function" && define.amd ? define(factory) : (global2 = typeof globalThis !== "undefined" ? globalThis : global2 || self, global2.Dexie = factory());
      })(exports, (function() {
        "use strict";
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        function __extends(d, b) {
          if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        }
        var __assign = function() {
          __assign = Object.assign || function __assign2(t) {
            for (var s, i = 1, n = arguments.length; i < n; i++) {
              s = arguments[i];
              for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
            }
            return t;
          };
          return __assign.apply(this, arguments);
        };
        function __spreadArray(to, from, pack) {
          if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
            if (ar || !(i in from)) {
              if (!ar) ar = Array.prototype.slice.call(from, 0, i);
              ar[i] = from[i];
            }
          }
          return to.concat(ar || Array.prototype.slice.call(from));
        }
        typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
          var e = new Error(message);
          return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
        };
        var _global = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : global;
        var keys = Object.keys;
        var isArray = Array.isArray;
        if (typeof Promise !== "undefined" && !_global.Promise) {
          _global.Promise = Promise;
        }
        function extend(obj, extension) {
          if (typeof extension !== "object")
            return obj;
          keys(extension).forEach(function(key) {
            obj[key] = extension[key];
          });
          return obj;
        }
        var getProto = Object.getPrototypeOf;
        var _hasOwn = {}.hasOwnProperty;
        function hasOwn(obj, prop) {
          return _hasOwn.call(obj, prop);
        }
        function props(proto, extension) {
          if (typeof extension === "function")
            extension = extension(getProto(proto));
          (typeof Reflect === "undefined" ? keys : Reflect.ownKeys)(extension).forEach(function(key) {
            setProp(proto, key, extension[key]);
          });
        }
        var defineProperty = Object.defineProperty;
        function setProp(obj, prop, functionOrGetSet, options) {
          defineProperty(obj, prop, extend(functionOrGetSet && hasOwn(functionOrGetSet, "get") && typeof functionOrGetSet.get === "function" ? {
            get: functionOrGetSet.get,
            set: functionOrGetSet.set,
            configurable: true
          } : { value: functionOrGetSet, configurable: true, writable: true }, options));
        }
        function derive(Child) {
          return {
            from: function(Parent) {
              Child.prototype = Object.create(Parent.prototype);
              setProp(Child.prototype, "constructor", Child);
              return {
                extend: props.bind(null, Child.prototype)
              };
            }
          };
        }
        var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        function getPropertyDescriptor(obj, prop) {
          var pd = getOwnPropertyDescriptor(obj, prop);
          var proto;
          return pd || (proto = getProto(obj)) && getPropertyDescriptor(proto, prop);
        }
        var _slice = [].slice;
        function slice(args, start, end) {
          return _slice.call(args, start, end);
        }
        function override(origFunc, overridedFactory) {
          return overridedFactory(origFunc);
        }
        function assert(b) {
          if (!b)
            throw new Error("Assertion Failed");
        }
        function asap$1(fn) {
          if (_global.setImmediate)
            setImmediate(fn);
          else
            setTimeout(fn, 0);
        }
        function arrayToObject(array, extractor) {
          return array.reduce(function(result, item, i) {
            var nameAndValue = extractor(item, i);
            if (nameAndValue)
              result[nameAndValue[0]] = nameAndValue[1];
            return result;
          }, {});
        }
        function getByKeyPath(obj, keyPath) {
          if (typeof keyPath === "string" && hasOwn(obj, keyPath))
            return obj[keyPath];
          if (!keyPath)
            return obj;
          if (typeof keyPath !== "string") {
            var rv = [];
            for (var i = 0, l = keyPath.length; i < l; ++i) {
              var val = getByKeyPath(obj, keyPath[i]);
              rv.push(val);
            }
            return rv;
          }
          var period = keyPath.indexOf(".");
          if (period !== -1) {
            var innerObj = obj[keyPath.substr(0, period)];
            return innerObj == null ? void 0 : getByKeyPath(innerObj, keyPath.substr(period + 1));
          }
          return void 0;
        }
        function setByKeyPath(obj, keyPath, value) {
          if (!obj || keyPath === void 0)
            return;
          if ("isFrozen" in Object && Object.isFrozen(obj))
            return;
          if (typeof keyPath !== "string" && "length" in keyPath) {
            assert(typeof value !== "string" && "length" in value);
            for (var i = 0, l = keyPath.length; i < l; ++i) {
              setByKeyPath(obj, keyPath[i], value[i]);
            }
          } else {
            var period = keyPath.indexOf(".");
            if (period !== -1) {
              var currentKeyPath = keyPath.substr(0, period);
              var remainingKeyPath = keyPath.substr(period + 1);
              if (remainingKeyPath === "")
                if (value === void 0) {
                  if (isArray(obj) && !isNaN(parseInt(currentKeyPath)))
                    obj.splice(currentKeyPath, 1);
                  else
                    delete obj[currentKeyPath];
                } else
                  obj[currentKeyPath] = value;
              else {
                var innerObj = obj[currentKeyPath];
                if (!innerObj || !hasOwn(obj, currentKeyPath)) {
                  if (value === void 0)
                    return;
                  innerObj = obj[currentKeyPath] = {};
                }
                setByKeyPath(innerObj, remainingKeyPath, value);
              }
            } else {
              if (value === void 0) {
                if (isArray(obj) && !isNaN(parseInt(keyPath)))
                  obj.splice(keyPath, 1);
                else
                  delete obj[keyPath];
              } else
                obj[keyPath] = value;
            }
          }
        }
        function delByKeyPath(obj, keyPath) {
          if (typeof keyPath === "string")
            setByKeyPath(obj, keyPath, void 0);
          else if ("length" in keyPath)
            [].map.call(keyPath, function(kp) {
              setByKeyPath(obj, kp, void 0);
            });
        }
        function shallowClone(obj) {
          var rv = {};
          for (var m in obj) {
            if (hasOwn(obj, m))
              rv[m] = obj[m];
          }
          return rv;
        }
        var concat = [].concat;
        function flatten(a) {
          return concat.apply([], a);
        }
        var intrinsicTypeNames = "BigUint64Array,BigInt64Array,Array,Boolean,String,Date,RegExp,Blob,File,FileList,FileSystemFileHandle,FileSystemDirectoryHandle,ArrayBuffer,DataView,Uint8ClampedArray,ImageBitmap,ImageData,Map,Set,CryptoKey".split(",").concat(flatten([8, 16, 32, 64].map(function(num) {
          return ["Int", "Uint", "Float"].map(function(t) {
            return t + num + "Array";
          });
        }))).filter(function(t) {
          return _global[t];
        });
        var intrinsicTypes = new Set(intrinsicTypeNames.map(function(t) {
          return _global[t];
        }));
        function cloneSimpleObjectTree(o) {
          var rv = {};
          for (var k in o)
            if (hasOwn(o, k)) {
              var v = o[k];
              rv[k] = !v || typeof v !== "object" || intrinsicTypes.has(v.constructor) ? v : cloneSimpleObjectTree(v);
            }
          return rv;
        }
        var circularRefs = null;
        function deepClone(any) {
          circularRefs = /* @__PURE__ */ new WeakMap();
          var rv = innerDeepClone(any);
          circularRefs = null;
          return rv;
        }
        function innerDeepClone(x) {
          if (!x || typeof x !== "object")
            return x;
          var rv = circularRefs.get(x);
          if (rv)
            return rv;
          if (isArray(x)) {
            rv = [];
            circularRefs.set(x, rv);
            for (var i = 0, l = x.length; i < l; ++i) {
              rv.push(innerDeepClone(x[i]));
            }
          } else if (intrinsicTypes.has(x.constructor)) {
            rv = x;
          } else {
            var proto = getProto(x);
            rv = proto === Object.prototype ? {} : Object.create(proto);
            circularRefs.set(x, rv);
            for (var prop in x) {
              if (hasOwn(x, prop)) {
                rv[prop] = innerDeepClone(x[prop]);
              }
            }
          }
          return rv;
        }
        var toString = {}.toString;
        function toStringTag(o) {
          return toString.call(o).slice(8, -1);
        }
        var iteratorSymbol = typeof Symbol !== "undefined" ? Symbol.iterator : "@@iterator";
        var getIteratorOf = typeof iteratorSymbol === "symbol" ? function(x) {
          var i;
          return x != null && (i = x[iteratorSymbol]) && i.apply(x);
        } : function() {
          return null;
        };
        function delArrayItem(a, x) {
          var i = a.indexOf(x);
          if (i >= 0)
            a.splice(i, 1);
          return i >= 0;
        }
        var NO_CHAR_ARRAY = {};
        function getArrayOf(arrayLike) {
          var i, a, x, it;
          if (arguments.length === 1) {
            if (isArray(arrayLike))
              return arrayLike.slice();
            if (this === NO_CHAR_ARRAY && typeof arrayLike === "string")
              return [arrayLike];
            if (it = getIteratorOf(arrayLike)) {
              a = [];
              while (x = it.next(), !x.done)
                a.push(x.value);
              return a;
            }
            if (arrayLike == null)
              return [arrayLike];
            i = arrayLike.length;
            if (typeof i === "number") {
              a = new Array(i);
              while (i--)
                a[i] = arrayLike[i];
              return a;
            }
            return [arrayLike];
          }
          i = arguments.length;
          a = new Array(i);
          while (i--)
            a[i] = arguments[i];
          return a;
        }
        var isAsyncFunction = typeof Symbol !== "undefined" ? function(fn) {
          return fn[Symbol.toStringTag] === "AsyncFunction";
        } : function() {
          return false;
        };
        var dexieErrorNames = [
          "Modify",
          "Bulk",
          "OpenFailed",
          "VersionChange",
          "Schema",
          "Upgrade",
          "InvalidTable",
          "MissingAPI",
          "NoSuchDatabase",
          "InvalidArgument",
          "SubTransaction",
          "Unsupported",
          "Internal",
          "DatabaseClosed",
          "PrematureCommit",
          "ForeignAwait"
        ];
        var idbDomErrorNames = [
          "Unknown",
          "Constraint",
          "Data",
          "TransactionInactive",
          "ReadOnly",
          "Version",
          "NotFound",
          "InvalidState",
          "InvalidAccess",
          "Abort",
          "Timeout",
          "QuotaExceeded",
          "Syntax",
          "DataClone"
        ];
        var errorList = dexieErrorNames.concat(idbDomErrorNames);
        var defaultTexts = {
          VersionChanged: "Database version changed by other database connection",
          DatabaseClosed: "Database has been closed",
          Abort: "Transaction aborted",
          TransactionInactive: "Transaction has already completed or failed",
          MissingAPI: "IndexedDB API missing. Please visit https://tinyurl.com/y2uuvskb"
        };
        function DexieError(name, msg) {
          this.name = name;
          this.message = msg;
        }
        derive(DexieError).from(Error).extend({
          toString: function() {
            return this.name + ": " + this.message;
          }
        });
        function getMultiErrorMessage(msg, failures) {
          return msg + ". Errors: " + Object.keys(failures).map(function(key) {
            return failures[key].toString();
          }).filter(function(v, i, s) {
            return s.indexOf(v) === i;
          }).join("\n");
        }
        function ModifyError(msg, failures, successCount, failedKeys) {
          this.failures = failures;
          this.failedKeys = failedKeys;
          this.successCount = successCount;
          this.message = getMultiErrorMessage(msg, failures);
        }
        derive(ModifyError).from(DexieError);
        function BulkError(msg, failures) {
          this.name = "BulkError";
          this.failures = Object.keys(failures).map(function(pos) {
            return failures[pos];
          });
          this.failuresByPos = failures;
          this.message = getMultiErrorMessage(msg, this.failures);
        }
        derive(BulkError).from(DexieError);
        var errnames = errorList.reduce(function(obj, name) {
          return obj[name] = name + "Error", obj;
        }, {});
        var BaseException = DexieError;
        var exceptions = errorList.reduce(function(obj, name) {
          var fullName = name + "Error";
          function DexieError2(msgOrInner, inner) {
            this.name = fullName;
            if (!msgOrInner) {
              this.message = defaultTexts[name] || fullName;
              this.inner = null;
            } else if (typeof msgOrInner === "string") {
              this.message = "".concat(msgOrInner).concat(!inner ? "" : "\n " + inner);
              this.inner = inner || null;
            } else if (typeof msgOrInner === "object") {
              this.message = "".concat(msgOrInner.name, " ").concat(msgOrInner.message);
              this.inner = msgOrInner;
            }
          }
          derive(DexieError2).from(BaseException);
          obj[name] = DexieError2;
          return obj;
        }, {});
        exceptions.Syntax = SyntaxError;
        exceptions.Type = TypeError;
        exceptions.Range = RangeError;
        var exceptionMap = idbDomErrorNames.reduce(function(obj, name) {
          obj[name + "Error"] = exceptions[name];
          return obj;
        }, {});
        function mapError(domError, message) {
          if (!domError || domError instanceof DexieError || domError instanceof TypeError || domError instanceof SyntaxError || !domError.name || !exceptionMap[domError.name])
            return domError;
          var rv = new exceptionMap[domError.name](message || domError.message, domError);
          if ("stack" in domError) {
            setProp(rv, "stack", {
              get: function() {
                return this.inner.stack;
              }
            });
          }
          return rv;
        }
        var fullNameExceptions = errorList.reduce(function(obj, name) {
          if (["Syntax", "Type", "Range"].indexOf(name) === -1)
            obj[name + "Error"] = exceptions[name];
          return obj;
        }, {});
        fullNameExceptions.ModifyError = ModifyError;
        fullNameExceptions.DexieError = DexieError;
        fullNameExceptions.BulkError = BulkError;
        function nop() {
        }
        function mirror(val) {
          return val;
        }
        function pureFunctionChain(f1, f2) {
          if (f1 == null || f1 === mirror)
            return f2;
          return function(val) {
            return f2(f1(val));
          };
        }
        function callBoth(on1, on2) {
          return function() {
            on1.apply(this, arguments);
            on2.apply(this, arguments);
          };
        }
        function hookCreatingChain(f1, f2) {
          if (f1 === nop)
            return f2;
          return function() {
            var res = f1.apply(this, arguments);
            if (res !== void 0)
              arguments[0] = res;
            var onsuccess = this.onsuccess, onerror = this.onerror;
            this.onsuccess = null;
            this.onerror = null;
            var res2 = f2.apply(this, arguments);
            if (onsuccess)
              this.onsuccess = this.onsuccess ? callBoth(onsuccess, this.onsuccess) : onsuccess;
            if (onerror)
              this.onerror = this.onerror ? callBoth(onerror, this.onerror) : onerror;
            return res2 !== void 0 ? res2 : res;
          };
        }
        function hookDeletingChain(f1, f2) {
          if (f1 === nop)
            return f2;
          return function() {
            f1.apply(this, arguments);
            var onsuccess = this.onsuccess, onerror = this.onerror;
            this.onsuccess = this.onerror = null;
            f2.apply(this, arguments);
            if (onsuccess)
              this.onsuccess = this.onsuccess ? callBoth(onsuccess, this.onsuccess) : onsuccess;
            if (onerror)
              this.onerror = this.onerror ? callBoth(onerror, this.onerror) : onerror;
          };
        }
        function hookUpdatingChain(f1, f2) {
          if (f1 === nop)
            return f2;
          return function(modifications) {
            var res = f1.apply(this, arguments);
            extend(modifications, res);
            var onsuccess = this.onsuccess, onerror = this.onerror;
            this.onsuccess = null;
            this.onerror = null;
            var res2 = f2.apply(this, arguments);
            if (onsuccess)
              this.onsuccess = this.onsuccess ? callBoth(onsuccess, this.onsuccess) : onsuccess;
            if (onerror)
              this.onerror = this.onerror ? callBoth(onerror, this.onerror) : onerror;
            return res === void 0 ? res2 === void 0 ? void 0 : res2 : extend(res, res2);
          };
        }
        function reverseStoppableEventChain(f1, f2) {
          if (f1 === nop)
            return f2;
          return function() {
            if (f2.apply(this, arguments) === false)
              return false;
            return f1.apply(this, arguments);
          };
        }
        function promisableChain(f1, f2) {
          if (f1 === nop)
            return f2;
          return function() {
            var res = f1.apply(this, arguments);
            if (res && typeof res.then === "function") {
              var thiz = this, i = arguments.length, args = new Array(i);
              while (i--)
                args[i] = arguments[i];
              return res.then(function() {
                return f2.apply(thiz, args);
              });
            }
            return f2.apply(this, arguments);
          };
        }
        var debug = typeof location !== "undefined" && /^(http|https):\/\/(localhost|127\.0\.0\.1)/.test(location.href);
        function setDebug(value, filter) {
          debug = value;
        }
        var INTERNAL = {};
        var ZONE_ECHO_LIMIT = 100, _a$1 = typeof Promise === "undefined" ? [] : (function() {
          var globalP = Promise.resolve();
          if (typeof crypto === "undefined" || !crypto.subtle)
            return [globalP, getProto(globalP), globalP];
          var nativeP = crypto.subtle.digest("SHA-512", new Uint8Array([0]));
          return [nativeP, getProto(nativeP), globalP];
        })(), resolvedNativePromise = _a$1[0], nativePromiseProto = _a$1[1], resolvedGlobalPromise = _a$1[2], nativePromiseThen = nativePromiseProto && nativePromiseProto.then;
        var NativePromise = resolvedNativePromise && resolvedNativePromise.constructor;
        var patchGlobalPromise = !!resolvedGlobalPromise;
        function schedulePhysicalTick() {
          queueMicrotask(physicalTick);
        }
        var asap = function(callback, args) {
          microtickQueue.push([callback, args]);
          if (needsNewPhysicalTick) {
            schedulePhysicalTick();
            needsNewPhysicalTick = false;
          }
        };
        var isOutsideMicroTick = true, needsNewPhysicalTick = true, unhandledErrors = [], rejectingErrors = [], rejectionMapper = mirror;
        var globalPSD = {
          id: "global",
          global: true,
          ref: 0,
          unhandleds: [],
          onunhandled: nop,
          pgp: false,
          env: {},
          finalize: nop
        };
        var PSD = globalPSD;
        var microtickQueue = [];
        var numScheduledCalls = 0;
        var tickFinalizers = [];
        function DexiePromise(fn) {
          if (typeof this !== "object")
            throw new TypeError("Promises must be constructed via new");
          this._listeners = [];
          this._lib = false;
          var psd = this._PSD = PSD;
          if (typeof fn !== "function") {
            if (fn !== INTERNAL)
              throw new TypeError("Not a function");
            this._state = arguments[1];
            this._value = arguments[2];
            if (this._state === false)
              handleRejection(this, this._value);
            return;
          }
          this._state = null;
          this._value = null;
          ++psd.ref;
          executePromiseTask(this, fn);
        }
        var thenProp = {
          get: function() {
            var psd = PSD, microTaskId = totalEchoes;
            function then(onFulfilled, onRejected) {
              var _this = this;
              var possibleAwait = !psd.global && (psd !== PSD || microTaskId !== totalEchoes);
              var cleanup = possibleAwait && !decrementExpectedAwaits();
              var rv = new DexiePromise(function(resolve, reject) {
                propagateToListener(_this, new Listener(nativeAwaitCompatibleWrap(onFulfilled, psd, possibleAwait, cleanup), nativeAwaitCompatibleWrap(onRejected, psd, possibleAwait, cleanup), resolve, reject, psd));
              });
              if (this._consoleTask)
                rv._consoleTask = this._consoleTask;
              return rv;
            }
            then.prototype = INTERNAL;
            return then;
          },
          set: function(value) {
            setProp(this, "then", value && value.prototype === INTERNAL ? thenProp : {
              get: function() {
                return value;
              },
              set: thenProp.set
            });
          }
        };
        props(DexiePromise.prototype, {
          then: thenProp,
          _then: function(onFulfilled, onRejected) {
            propagateToListener(this, new Listener(null, null, onFulfilled, onRejected, PSD));
          },
          catch: function(onRejected) {
            if (arguments.length === 1)
              return this.then(null, onRejected);
            var type2 = arguments[0], handler = arguments[1];
            return typeof type2 === "function" ? this.then(null, function(err) {
              return err instanceof type2 ? handler(err) : PromiseReject(err);
            }) : this.then(null, function(err) {
              return err && err.name === type2 ? handler(err) : PromiseReject(err);
            });
          },
          finally: function(onFinally) {
            return this.then(function(value) {
              return DexiePromise.resolve(onFinally()).then(function() {
                return value;
              });
            }, function(err) {
              return DexiePromise.resolve(onFinally()).then(function() {
                return PromiseReject(err);
              });
            });
          },
          timeout: function(ms, msg) {
            var _this = this;
            return ms < Infinity ? new DexiePromise(function(resolve, reject) {
              var handle = setTimeout(function() {
                return reject(new exceptions.Timeout(msg));
              }, ms);
              _this.then(resolve, reject).finally(clearTimeout.bind(null, handle));
            }) : this;
          }
        });
        if (typeof Symbol !== "undefined" && Symbol.toStringTag)
          setProp(DexiePromise.prototype, Symbol.toStringTag, "Dexie.Promise");
        globalPSD.env = snapShot();
        function Listener(onFulfilled, onRejected, resolve, reject, zone) {
          this.onFulfilled = typeof onFulfilled === "function" ? onFulfilled : null;
          this.onRejected = typeof onRejected === "function" ? onRejected : null;
          this.resolve = resolve;
          this.reject = reject;
          this.psd = zone;
        }
        props(DexiePromise, {
          all: function() {
            var values = getArrayOf.apply(null, arguments).map(onPossibleParallellAsync);
            return new DexiePromise(function(resolve, reject) {
              if (values.length === 0)
                resolve([]);
              var remaining = values.length;
              values.forEach(function(a, i) {
                return DexiePromise.resolve(a).then(function(x) {
                  values[i] = x;
                  if (!--remaining)
                    resolve(values);
                }, reject);
              });
            });
          },
          resolve: function(value) {
            if (value instanceof DexiePromise)
              return value;
            if (value && typeof value.then === "function")
              return new DexiePromise(function(resolve, reject) {
                value.then(resolve, reject);
              });
            var rv = new DexiePromise(INTERNAL, true, value);
            return rv;
          },
          reject: PromiseReject,
          race: function() {
            var values = getArrayOf.apply(null, arguments).map(onPossibleParallellAsync);
            return new DexiePromise(function(resolve, reject) {
              values.map(function(value) {
                return DexiePromise.resolve(value).then(resolve, reject);
              });
            });
          },
          PSD: {
            get: function() {
              return PSD;
            },
            set: function(value) {
              return PSD = value;
            }
          },
          totalEchoes: { get: function() {
            return totalEchoes;
          } },
          newPSD: newScope,
          usePSD,
          scheduler: {
            get: function() {
              return asap;
            },
            set: function(value) {
              asap = value;
            }
          },
          rejectionMapper: {
            get: function() {
              return rejectionMapper;
            },
            set: function(value) {
              rejectionMapper = value;
            }
          },
          follow: function(fn, zoneProps) {
            return new DexiePromise(function(resolve, reject) {
              return newScope(function(resolve2, reject2) {
                var psd = PSD;
                psd.unhandleds = [];
                psd.onunhandled = reject2;
                psd.finalize = callBoth(function() {
                  var _this = this;
                  run_at_end_of_this_or_next_physical_tick(function() {
                    _this.unhandleds.length === 0 ? resolve2() : reject2(_this.unhandleds[0]);
                  });
                }, psd.finalize);
                fn();
              }, zoneProps, resolve, reject);
            });
          }
        });
        if (NativePromise) {
          if (NativePromise.allSettled)
            setProp(DexiePromise, "allSettled", function() {
              var possiblePromises = getArrayOf.apply(null, arguments).map(onPossibleParallellAsync);
              return new DexiePromise(function(resolve) {
                if (possiblePromises.length === 0)
                  resolve([]);
                var remaining = possiblePromises.length;
                var results = new Array(remaining);
                possiblePromises.forEach(function(p, i) {
                  return DexiePromise.resolve(p).then(function(value) {
                    return results[i] = { status: "fulfilled", value };
                  }, function(reason) {
                    return results[i] = { status: "rejected", reason };
                  }).then(function() {
                    return --remaining || resolve(results);
                  });
                });
              });
            });
          if (NativePromise.any && typeof AggregateError !== "undefined")
            setProp(DexiePromise, "any", function() {
              var possiblePromises = getArrayOf.apply(null, arguments).map(onPossibleParallellAsync);
              return new DexiePromise(function(resolve, reject) {
                if (possiblePromises.length === 0)
                  reject(new AggregateError([]));
                var remaining = possiblePromises.length;
                var failures = new Array(remaining);
                possiblePromises.forEach(function(p, i) {
                  return DexiePromise.resolve(p).then(function(value) {
                    return resolve(value);
                  }, function(failure) {
                    failures[i] = failure;
                    if (!--remaining)
                      reject(new AggregateError(failures));
                  });
                });
              });
            });
          if (NativePromise.withResolvers)
            DexiePromise.withResolvers = NativePromise.withResolvers;
        }
        function executePromiseTask(promise, fn) {
          try {
            fn(function(value) {
              if (promise._state !== null)
                return;
              if (value === promise)
                throw new TypeError("A promise cannot be resolved with itself.");
              var shouldExecuteTick = promise._lib && beginMicroTickScope();
              if (value && typeof value.then === "function") {
                executePromiseTask(promise, function(resolve, reject) {
                  value instanceof DexiePromise ? value._then(resolve, reject) : value.then(resolve, reject);
                });
              } else {
                promise._state = true;
                promise._value = value;
                propagateAllListeners(promise);
              }
              if (shouldExecuteTick)
                endMicroTickScope();
            }, handleRejection.bind(null, promise));
          } catch (ex) {
            handleRejection(promise, ex);
          }
        }
        function handleRejection(promise, reason) {
          rejectingErrors.push(reason);
          if (promise._state !== null)
            return;
          var shouldExecuteTick = promise._lib && beginMicroTickScope();
          reason = rejectionMapper(reason);
          promise._state = false;
          promise._value = reason;
          addPossiblyUnhandledError(promise);
          propagateAllListeners(promise);
          if (shouldExecuteTick)
            endMicroTickScope();
        }
        function propagateAllListeners(promise) {
          var listeners = promise._listeners;
          promise._listeners = [];
          for (var i = 0, len = listeners.length; i < len; ++i) {
            propagateToListener(promise, listeners[i]);
          }
          var psd = promise._PSD;
          --psd.ref || psd.finalize();
          if (numScheduledCalls === 0) {
            ++numScheduledCalls;
            asap(function() {
              if (--numScheduledCalls === 0)
                finalizePhysicalTick();
            }, []);
          }
        }
        function propagateToListener(promise, listener) {
          if (promise._state === null) {
            promise._listeners.push(listener);
            return;
          }
          var cb = promise._state ? listener.onFulfilled : listener.onRejected;
          if (cb === null) {
            return (promise._state ? listener.resolve : listener.reject)(promise._value);
          }
          ++listener.psd.ref;
          ++numScheduledCalls;
          asap(callListener, [cb, promise, listener]);
        }
        function callListener(cb, promise, listener) {
          try {
            var ret, value = promise._value;
            if (!promise._state && rejectingErrors.length)
              rejectingErrors = [];
            ret = debug && promise._consoleTask ? promise._consoleTask.run(function() {
              return cb(value);
            }) : cb(value);
            if (!promise._state && rejectingErrors.indexOf(value) === -1) {
              markErrorAsHandled(promise);
            }
            listener.resolve(ret);
          } catch (e) {
            listener.reject(e);
          } finally {
            if (--numScheduledCalls === 0)
              finalizePhysicalTick();
            --listener.psd.ref || listener.psd.finalize();
          }
        }
        function physicalTick() {
          usePSD(globalPSD, function() {
            beginMicroTickScope() && endMicroTickScope();
          });
        }
        function beginMicroTickScope() {
          var wasRootExec = isOutsideMicroTick;
          isOutsideMicroTick = false;
          needsNewPhysicalTick = false;
          return wasRootExec;
        }
        function endMicroTickScope() {
          var callbacks, i, l;
          do {
            while (microtickQueue.length > 0) {
              callbacks = microtickQueue;
              microtickQueue = [];
              l = callbacks.length;
              for (i = 0; i < l; ++i) {
                var item = callbacks[i];
                item[0].apply(null, item[1]);
              }
            }
          } while (microtickQueue.length > 0);
          isOutsideMicroTick = true;
          needsNewPhysicalTick = true;
        }
        function finalizePhysicalTick() {
          var unhandledErrs = unhandledErrors;
          unhandledErrors = [];
          unhandledErrs.forEach(function(p) {
            p._PSD.onunhandled.call(null, p._value, p);
          });
          var finalizers = tickFinalizers.slice(0);
          var i = finalizers.length;
          while (i)
            finalizers[--i]();
        }
        function run_at_end_of_this_or_next_physical_tick(fn) {
          function finalizer() {
            fn();
            tickFinalizers.splice(tickFinalizers.indexOf(finalizer), 1);
          }
          tickFinalizers.push(finalizer);
          ++numScheduledCalls;
          asap(function() {
            if (--numScheduledCalls === 0)
              finalizePhysicalTick();
          }, []);
        }
        function addPossiblyUnhandledError(promise) {
          if (!unhandledErrors.some(function(p) {
            return p._value === promise._value;
          }))
            unhandledErrors.push(promise);
        }
        function markErrorAsHandled(promise) {
          var i = unhandledErrors.length;
          while (i)
            if (unhandledErrors[--i]._value === promise._value) {
              unhandledErrors.splice(i, 1);
              return;
            }
        }
        function PromiseReject(reason) {
          return new DexiePromise(INTERNAL, false, reason);
        }
        function wrap(fn, errorCatcher) {
          var psd = PSD;
          return function() {
            var wasRootExec = beginMicroTickScope(), outerScope = PSD;
            try {
              switchToZone(psd, true);
              return fn.apply(this, arguments);
            } catch (e) {
              errorCatcher && errorCatcher(e);
            } finally {
              switchToZone(outerScope, false);
              if (wasRootExec)
                endMicroTickScope();
            }
          };
        }
        var task = { awaits: 0, echoes: 0, id: 0 };
        var taskCounter = 0;
        var zoneStack = [];
        var zoneEchoes = 0;
        var totalEchoes = 0;
        var zone_id_counter = 0;
        function newScope(fn, props2, a1, a2) {
          var parent = PSD, psd = Object.create(parent);
          psd.parent = parent;
          psd.ref = 0;
          psd.global = false;
          psd.id = ++zone_id_counter;
          globalPSD.env;
          psd.env = patchGlobalPromise ? {
            Promise: DexiePromise,
            PromiseProp: {
              value: DexiePromise,
              configurable: true,
              writable: true
            },
            all: DexiePromise.all,
            race: DexiePromise.race,
            allSettled: DexiePromise.allSettled,
            any: DexiePromise.any,
            resolve: DexiePromise.resolve,
            reject: DexiePromise.reject
          } : {};
          if (props2)
            extend(psd, props2);
          ++parent.ref;
          psd.finalize = function() {
            --this.parent.ref || this.parent.finalize();
          };
          var rv = usePSD(psd, fn, a1, a2);
          if (psd.ref === 0)
            psd.finalize();
          return rv;
        }
        function incrementExpectedAwaits() {
          if (!task.id)
            task.id = ++taskCounter;
          ++task.awaits;
          task.echoes += ZONE_ECHO_LIMIT;
          return task.id;
        }
        function decrementExpectedAwaits() {
          if (!task.awaits)
            return false;
          if (--task.awaits === 0)
            task.id = 0;
          task.echoes = task.awaits * ZONE_ECHO_LIMIT;
          return true;
        }
        if (("" + nativePromiseThen).indexOf("[native code]") === -1) {
          incrementExpectedAwaits = decrementExpectedAwaits = nop;
        }
        function onPossibleParallellAsync(possiblePromise) {
          if (task.echoes && possiblePromise && possiblePromise.constructor === NativePromise) {
            incrementExpectedAwaits();
            return possiblePromise.then(function(x) {
              decrementExpectedAwaits();
              return x;
            }, function(e) {
              decrementExpectedAwaits();
              return rejection(e);
            });
          }
          return possiblePromise;
        }
        function zoneEnterEcho(targetZone) {
          ++totalEchoes;
          if (!task.echoes || --task.echoes === 0) {
            task.echoes = task.awaits = task.id = 0;
          }
          zoneStack.push(PSD);
          switchToZone(targetZone, true);
        }
        function zoneLeaveEcho() {
          var zone = zoneStack[zoneStack.length - 1];
          zoneStack.pop();
          switchToZone(zone, false);
        }
        function switchToZone(targetZone, bEnteringZone) {
          var currentZone = PSD;
          if (bEnteringZone ? task.echoes && (!zoneEchoes++ || targetZone !== PSD) : zoneEchoes && (!--zoneEchoes || targetZone !== PSD)) {
            queueMicrotask(bEnteringZone ? zoneEnterEcho.bind(null, targetZone) : zoneLeaveEcho);
          }
          if (targetZone === PSD)
            return;
          PSD = targetZone;
          if (currentZone === globalPSD)
            globalPSD.env = snapShot();
          if (patchGlobalPromise) {
            var GlobalPromise = globalPSD.env.Promise;
            var targetEnv = targetZone.env;
            if (currentZone.global || targetZone.global) {
              Object.defineProperty(_global, "Promise", targetEnv.PromiseProp);
              GlobalPromise.all = targetEnv.all;
              GlobalPromise.race = targetEnv.race;
              GlobalPromise.resolve = targetEnv.resolve;
              GlobalPromise.reject = targetEnv.reject;
              if (targetEnv.allSettled)
                GlobalPromise.allSettled = targetEnv.allSettled;
              if (targetEnv.any)
                GlobalPromise.any = targetEnv.any;
            }
          }
        }
        function snapShot() {
          var GlobalPromise = _global.Promise;
          return patchGlobalPromise ? {
            Promise: GlobalPromise,
            PromiseProp: Object.getOwnPropertyDescriptor(_global, "Promise"),
            all: GlobalPromise.all,
            race: GlobalPromise.race,
            allSettled: GlobalPromise.allSettled,
            any: GlobalPromise.any,
            resolve: GlobalPromise.resolve,
            reject: GlobalPromise.reject
          } : {};
        }
        function usePSD(psd, fn, a1, a2, a3) {
          var outerScope = PSD;
          try {
            switchToZone(psd, true);
            return fn(a1, a2, a3);
          } finally {
            switchToZone(outerScope, false);
          }
        }
        function nativeAwaitCompatibleWrap(fn, zone, possibleAwait, cleanup) {
          return typeof fn !== "function" ? fn : function() {
            var outerZone = PSD;
            if (possibleAwait)
              incrementExpectedAwaits();
            switchToZone(zone, true);
            try {
              return fn.apply(this, arguments);
            } finally {
              switchToZone(outerZone, false);
              if (cleanup)
                queueMicrotask(decrementExpectedAwaits);
            }
          };
        }
        function execInGlobalContext(cb) {
          if (Promise === NativePromise && task.echoes === 0) {
            if (zoneEchoes === 0) {
              cb();
            } else {
              enqueueNativeMicroTask(cb);
            }
          } else {
            setTimeout(cb, 0);
          }
        }
        var rejection = DexiePromise.reject;
        function tempTransaction(db, mode, storeNames, fn) {
          if (!db.idbdb || !db._state.openComplete && !PSD.letThrough && !db._vip) {
            if (db._state.openComplete) {
              return rejection(new exceptions.DatabaseClosed(db._state.dbOpenError));
            }
            if (!db._state.isBeingOpened) {
              if (!db._state.autoOpen)
                return rejection(new exceptions.DatabaseClosed());
              db.open().catch(nop);
            }
            return db._state.dbReadyPromise.then(function() {
              return tempTransaction(db, mode, storeNames, fn);
            });
          } else {
            var trans = db._createTransaction(mode, storeNames, db._dbSchema);
            try {
              trans.create();
              db._state.PR1398_maxLoop = 3;
            } catch (ex) {
              if (ex.name === errnames.InvalidState && db.isOpen() && --db._state.PR1398_maxLoop > 0) {
                console.warn("Dexie: Need to reopen db");
                db.close({ disableAutoOpen: false });
                return db.open().then(function() {
                  return tempTransaction(db, mode, storeNames, fn);
                });
              }
              return rejection(ex);
            }
            return trans._promise(mode, function(resolve, reject) {
              return newScope(function() {
                PSD.trans = trans;
                return fn(resolve, reject, trans);
              });
            }).then(function(result) {
              if (mode === "readwrite")
                try {
                  trans.idbtrans.commit();
                } catch (_a2) {
                }
              return mode === "readonly" ? result : trans._completion.then(function() {
                return result;
              });
            });
          }
        }
        var DEXIE_VERSION = "4.4.4";
        var maxString = String.fromCharCode(65535);
        var minKey = -Infinity;
        var INVALID_KEY_ARGUMENT = "Invalid key provided. Keys must be of type string, number, Date or Array<string | number | Date>.";
        var STRING_EXPECTED = "String expected.";
        var DEFAULT_MAX_CONNECTIONS = 1e3;
        var DBNAMES_DB = "__dbnames";
        var READONLY = "readonly";
        var READWRITE = "readwrite";
        function combine(filter1, filter2) {
          return filter1 ? filter2 ? function() {
            return filter1.apply(this, arguments) && filter2.apply(this, arguments);
          } : filter1 : filter2;
        }
        var AnyRange = {
          type: 3,
          lower: -Infinity,
          lowerOpen: false,
          upper: [[]],
          upperOpen: false
        };
        function workaroundForUndefinedPrimKey(keyPath) {
          return typeof keyPath === "string" && !/\./.test(keyPath) ? function(obj) {
            if (obj[keyPath] === void 0 && keyPath in obj) {
              obj = deepClone(obj);
              delete obj[keyPath];
            }
            return obj;
          } : function(obj) {
            return obj;
          };
        }
        function Entity2() {
          throw exceptions.Type("Entity instances must never be new:ed. Instances are generated by the framework bypassing the constructor.");
        }
        function cmp2(a, b) {
          try {
            var ta = type(a);
            var tb = type(b);
            if (ta !== tb) {
              if (ta === "Array")
                return 1;
              if (tb === "Array")
                return -1;
              if (ta === "binary")
                return 1;
              if (tb === "binary")
                return -1;
              if (ta === "string")
                return 1;
              if (tb === "string")
                return -1;
              if (ta === "Date")
                return 1;
              if (tb !== "Date")
                return NaN;
              return -1;
            }
            switch (ta) {
              case "number":
              case "Date":
              case "string":
                return a > b ? 1 : a < b ? -1 : 0;
              case "binary": {
                return compareUint8Arrays(getUint8Array(a), getUint8Array(b));
              }
              case "Array":
                return compareArrays(a, b);
            }
          } catch (_a2) {
          }
          return NaN;
        }
        function compareArrays(a, b) {
          var al = a.length;
          var bl = b.length;
          var l = al < bl ? al : bl;
          for (var i = 0; i < l; ++i) {
            var res = cmp2(a[i], b[i]);
            if (res !== 0)
              return res;
          }
          return al === bl ? 0 : al < bl ? -1 : 1;
        }
        function compareUint8Arrays(a, b) {
          var al = a.length;
          var bl = b.length;
          var l = al < bl ? al : bl;
          for (var i = 0; i < l; ++i) {
            if (a[i] !== b[i])
              return a[i] < b[i] ? -1 : 1;
          }
          return al === bl ? 0 : al < bl ? -1 : 1;
        }
        function type(x) {
          var t = typeof x;
          if (t !== "object")
            return t;
          if (ArrayBuffer.isView(x))
            return "binary";
          var tsTag = toStringTag(x);
          return tsTag === "ArrayBuffer" ? "binary" : tsTag;
        }
        function getUint8Array(a) {
          if (a instanceof Uint8Array)
            return a;
          if (ArrayBuffer.isView(a))
            return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
          return new Uint8Array(a);
        }
        function builtInDeletionTrigger(table, keys2, res) {
          var yProps = table.schema.yProps;
          if (!yProps)
            return res;
          if (keys2 && res.numFailures > 0)
            keys2 = keys2.filter(function(_, i) {
              return !res.failures[i];
            });
          return Promise.all(yProps.map(function(_a2) {
            var updatesTable = _a2.updatesTable;
            return keys2 ? table.db.table(updatesTable).where("k").anyOf(keys2).delete() : table.db.table(updatesTable).clear();
          })).then(function() {
            return res;
          });
        }
        var PropModification2 = (function() {
          function PropModification3(spec) {
            this["@@propmod"] = spec;
          }
          PropModification3.prototype.execute = function(value) {
            var _a2;
            var spec = this["@@propmod"];
            if (spec.add !== void 0) {
              var term = spec.add;
              if (isArray(term)) {
                return __spreadArray(__spreadArray([], isArray(value) ? value : [], true), term, true).sort();
              }
              if (typeof term === "number")
                return (Number(value) || 0) + term;
              if (typeof term === "bigint") {
                try {
                  return BigInt(value) + term;
                } catch (_b) {
                  return BigInt(0) + term;
                }
              }
              throw new TypeError("Invalid term ".concat(term));
            }
            if (spec.remove !== void 0) {
              var subtrahend_1 = spec.remove;
              if (isArray(subtrahend_1)) {
                return isArray(value) ? value.filter(function(item) {
                  return !subtrahend_1.includes(item);
                }).sort() : [];
              }
              if (typeof subtrahend_1 === "number")
                return Number(value) - subtrahend_1;
              if (typeof subtrahend_1 === "bigint") {
                try {
                  return BigInt(value) - subtrahend_1;
                } catch (_c) {
                  return BigInt(0) - subtrahend_1;
                }
              }
              throw new TypeError("Invalid subtrahend ".concat(subtrahend_1));
            }
            var prefixToReplace = (_a2 = spec.replacePrefix) === null || _a2 === void 0 ? void 0 : _a2[0];
            if (prefixToReplace && typeof value === "string" && value.startsWith(prefixToReplace)) {
              return spec.replacePrefix[1] + value.substring(prefixToReplace.length);
            }
            return value;
          };
          return PropModification3;
        })();
        function applyUpdateSpec(obj, changes) {
          var keyPaths = keys(changes);
          var numKeys = keyPaths.length;
          var anythingModified = false;
          for (var i = 0; i < numKeys; ++i) {
            var keyPath = keyPaths[i];
            var value = changes[keyPath];
            var origValue = getByKeyPath(obj, keyPath);
            if (value instanceof PropModification2) {
              setByKeyPath(obj, keyPath, value.execute(origValue));
              anythingModified = true;
            } else if (origValue !== value) {
              setByKeyPath(obj, keyPath, value);
              anythingModified = true;
            }
          }
          return anythingModified;
        }
        var Table = (function() {
          function Table2() {
          }
          Table2.prototype._trans = function(mode, fn, writeLocked) {
            var trans = this._tx || PSD.trans;
            var tableName = this.name;
            var task2 = debug && typeof console !== "undefined" && console.createTask && console.createTask("Dexie: ".concat(mode === "readonly" ? "read" : "write", " ").concat(this.name));
            function checkTableInTransaction(resolve, reject, trans2) {
              if (!trans2.schema[tableName])
                throw new exceptions.NotFound("Table " + tableName + " not part of transaction");
              return fn(trans2.idbtrans, trans2);
            }
            var wasRootExec = beginMicroTickScope();
            try {
              var p = trans && trans.db._novip === this.db._novip ? trans === PSD.trans ? trans._promise(mode, checkTableInTransaction, writeLocked) : newScope(function() {
                return trans._promise(mode, checkTableInTransaction, writeLocked);
              }, { trans, transless: PSD.transless || PSD }) : tempTransaction(this.db, mode, [this.name], checkTableInTransaction);
              if (task2) {
                p._consoleTask = task2;
                p = p.catch(function(err) {
                  console.trace(err);
                  return rejection(err);
                });
              }
              return p;
            } finally {
              if (wasRootExec)
                endMicroTickScope();
            }
          };
          Table2.prototype.get = function(keyOrCrit, cb) {
            var _this = this;
            if (keyOrCrit && keyOrCrit.constructor === Object)
              return this.where(keyOrCrit).first(cb);
            if (keyOrCrit == null)
              return rejection(new exceptions.Type("Invalid argument to Table.get()"));
            return this._trans("readonly", function(trans) {
              return _this.core.get({ trans, key: keyOrCrit }).then(function(res) {
                return _this.hook.reading.fire(res);
              });
            }).then(cb);
          };
          Table2.prototype.where = function(indexOrCrit) {
            if (typeof indexOrCrit === "string")
              return new this.db.WhereClause(this, indexOrCrit);
            if (isArray(indexOrCrit))
              return new this.db.WhereClause(this, "[".concat(indexOrCrit.join("+"), "]"));
            var keyPaths = keys(indexOrCrit);
            if (keyPaths.length === 1)
              return this.where(keyPaths[0]).equals(indexOrCrit[keyPaths[0]]);
            var compoundIndex = this.schema.indexes.concat(this.schema.primKey).filter(function(ix) {
              if (ix.compound && keyPaths.every(function(keyPath) {
                return ix.keyPath.indexOf(keyPath) >= 0;
              })) {
                for (var i = 0; i < keyPaths.length; ++i) {
                  if (keyPaths.indexOf(ix.keyPath[i]) === -1)
                    return false;
                }
                return true;
              }
              return false;
            }).sort(function(a, b) {
              return a.keyPath.length - b.keyPath.length;
            })[0];
            if (compoundIndex && this.db._maxKey !== maxString) {
              var keyPathsInValidOrder = compoundIndex.keyPath.slice(0, keyPaths.length);
              return this.where(keyPathsInValidOrder).equals(keyPathsInValidOrder.map(function(kp) {
                return indexOrCrit[kp];
              }));
            }
            if (!compoundIndex && debug)
              console.warn("The query ".concat(JSON.stringify(indexOrCrit), " on ").concat(this.name, " would benefit from a ") + "compound index [".concat(keyPaths.join("+"), "]"));
            var idxByName = this.schema.idxByName;
            function equals(a, b) {
              return cmp2(a, b) === 0;
            }
            var _a2 = keyPaths.reduce(function(_a3, keyPath) {
              var prevIndex = _a3[0], prevFilterFn = _a3[1];
              var index = idxByName[keyPath];
              var value = indexOrCrit[keyPath];
              return [
                prevIndex || index,
                prevIndex || !index ? combine(prevFilterFn, index && index.multi ? function(x) {
                  var prop = getByKeyPath(x, keyPath);
                  return isArray(prop) && prop.some(function(item) {
                    return equals(value, item);
                  });
                } : function(x) {
                  return equals(value, getByKeyPath(x, keyPath));
                }) : prevFilterFn
              ];
            }, [null, null]), idx = _a2[0], filterFunction = _a2[1];
            return idx ? this.where(idx.name).equals(indexOrCrit[idx.keyPath]).filter(filterFunction) : compoundIndex ? this.filter(filterFunction) : this.where(keyPaths).equals("");
          };
          Table2.prototype.filter = function(filterFunction) {
            return this.toCollection().and(filterFunction);
          };
          Table2.prototype.count = function(thenShortcut) {
            return this.toCollection().count(thenShortcut);
          };
          Table2.prototype.offset = function(offset) {
            return this.toCollection().offset(offset);
          };
          Table2.prototype.limit = function(numRows) {
            return this.toCollection().limit(numRows);
          };
          Table2.prototype.each = function(callback) {
            return this.toCollection().each(callback);
          };
          Table2.prototype.toArray = function(thenShortcut) {
            return this.toCollection().toArray(thenShortcut);
          };
          Table2.prototype.toCollection = function() {
            return new this.db.Collection(new this.db.WhereClause(this));
          };
          Table2.prototype.orderBy = function(index) {
            return new this.db.Collection(new this.db.WhereClause(this, isArray(index) ? "[".concat(index.join("+"), "]") : index));
          };
          Table2.prototype.reverse = function() {
            return this.toCollection().reverse();
          };
          Table2.prototype.mapToClass = function(constructor) {
            var _a2 = this, db = _a2.db, tableName = _a2.name;
            this.schema.mappedClass = constructor;
            if (constructor.prototype instanceof Entity2) {
              constructor = (function(_super) {
                __extends(class_1, _super);
                function class_1() {
                  return _super !== null && _super.apply(this, arguments) || this;
                }
                Object.defineProperty(class_1.prototype, "db", {
                  get: function() {
                    return db;
                  },
                  enumerable: false,
                  configurable: true
                });
                class_1.prototype.table = function() {
                  return tableName;
                };
                return class_1;
              })(constructor);
            }
            var inheritedProps = /* @__PURE__ */ new Set();
            for (var proto = constructor.prototype; proto; proto = getProto(proto)) {
              Object.getOwnPropertyNames(proto).forEach(function(propName) {
                return inheritedProps.add(propName);
              });
            }
            var readHook = function(obj) {
              if (!obj)
                return obj;
              var res = Object.create(constructor.prototype);
              for (var m in obj)
                if (!inheritedProps.has(m))
                  try {
                    res[m] = obj[m];
                  } catch (_) {
                  }
              return res;
            };
            if (this.schema.readHook) {
              this.hook.reading.unsubscribe(this.schema.readHook);
            }
            this.schema.readHook = readHook;
            this.hook("reading", readHook);
            return constructor;
          };
          Table2.prototype.defineClass = function() {
            function Class(content) {
              extend(this, content);
            }
            return this.mapToClass(Class);
          };
          Table2.prototype.add = function(obj, key) {
            var _this = this;
            var _a2 = this.schema.primKey, auto = _a2.auto, keyPath = _a2.keyPath;
            var objToAdd = obj;
            if (keyPath && auto) {
              objToAdd = workaroundForUndefinedPrimKey(keyPath)(obj);
            }
            return this._trans("readwrite", function(trans) {
              return _this.core.mutate({
                trans,
                type: "add",
                keys: key != null ? [key] : null,
                values: [objToAdd]
              });
            }).then(function(res) {
              return res.numFailures ? DexiePromise.reject(res.failures[0]) : res.lastResult;
            }).then(function(lastResult) {
              if (keyPath) {
                try {
                  setByKeyPath(obj, keyPath, lastResult);
                } catch (_) {
                }
              }
              return lastResult;
            });
          };
          Table2.prototype.upsert = function(key, modifications) {
            var _this = this;
            var keyPath = this.schema.primKey.keyPath;
            return this._trans("readwrite", function(trans) {
              return _this.core.get({ trans, key }).then(function(existing) {
                var obj = existing !== null && existing !== void 0 ? existing : {};
                applyUpdateSpec(obj, modifications);
                if (keyPath)
                  setByKeyPath(obj, keyPath, key);
                return _this.core.mutate({
                  trans,
                  type: "put",
                  values: [obj],
                  keys: [key],
                  upsert: true,
                  updates: { keys: [key], changeSpecs: [modifications] }
                }).then(function(res) {
                  return res.numFailures ? DexiePromise.reject(res.failures[0]) : !!existing;
                });
              });
            });
          };
          Table2.prototype.update = function(keyOrObject, modifications) {
            if (typeof keyOrObject === "object" && !isArray(keyOrObject)) {
              var key = getByKeyPath(keyOrObject, this.schema.primKey.keyPath);
              if (key === void 0)
                return rejection(new exceptions.InvalidArgument("Given object does not contain its primary key"));
              return this.where(":id").equals(key).modify(modifications);
            } else {
              return this.where(":id").equals(keyOrObject).modify(modifications);
            }
          };
          Table2.prototype.put = function(obj, key) {
            var _this = this;
            var _a2 = this.schema.primKey, auto = _a2.auto, keyPath = _a2.keyPath;
            var objToAdd = obj;
            if (keyPath && auto) {
              objToAdd = workaroundForUndefinedPrimKey(keyPath)(obj);
            }
            return this._trans("readwrite", function(trans) {
              return _this.core.mutate({
                trans,
                type: "put",
                values: [objToAdd],
                keys: key != null ? [key] : null
              });
            }).then(function(res) {
              return res.numFailures ? DexiePromise.reject(res.failures[0]) : res.lastResult;
            }).then(function(lastResult) {
              if (keyPath) {
                try {
                  setByKeyPath(obj, keyPath, lastResult);
                } catch (_) {
                }
              }
              return lastResult;
            });
          };
          Table2.prototype.delete = function(key) {
            var _this = this;
            return this._trans("readwrite", function(trans) {
              return _this.core.mutate({ trans, type: "delete", keys: [key] }).then(function(res) {
                return builtInDeletionTrigger(_this, [key], res);
              }).then(function(res) {
                return res.numFailures ? DexiePromise.reject(res.failures[0]) : void 0;
              });
            });
          };
          Table2.prototype.clear = function() {
            var _this = this;
            return this._trans("readwrite", function(trans) {
              return _this.core.mutate({ trans, type: "deleteRange", range: AnyRange }).then(function(res) {
                return builtInDeletionTrigger(_this, null, res);
              });
            }).then(function(res) {
              return res.numFailures ? DexiePromise.reject(res.failures[0]) : void 0;
            });
          };
          Table2.prototype.bulkGet = function(keys2) {
            var _this = this;
            return this._trans("readonly", function(trans) {
              return _this.core.getMany({
                keys: keys2,
                trans
              }).then(function(result) {
                return result.map(function(res) {
                  return _this.hook.reading.fire(res);
                });
              });
            });
          };
          Table2.prototype.bulkAdd = function(objects, keysOrOptions, options) {
            var _this = this;
            var keys2 = Array.isArray(keysOrOptions) ? keysOrOptions : void 0;
            options = options || (keys2 ? void 0 : keysOrOptions);
            var wantResults = options ? options.allKeys : void 0;
            return this._trans("readwrite", function(trans) {
              var _a2 = _this.schema.primKey, auto = _a2.auto, keyPath = _a2.keyPath;
              if (keyPath && keys2)
                throw new exceptions.InvalidArgument("bulkAdd(): keys argument invalid on tables with inbound keys");
              if (keys2 && keys2.length !== objects.length)
                throw new exceptions.InvalidArgument("Arguments objects and keys must have the same length");
              var numObjects = objects.length;
              var objectsToAdd = keyPath && auto ? objects.map(workaroundForUndefinedPrimKey(keyPath)) : objects;
              return _this.core.mutate({
                trans,
                type: "add",
                keys: keys2,
                values: objectsToAdd,
                wantResults
              }).then(function(_a3) {
                var numFailures = _a3.numFailures, results = _a3.results, lastResult = _a3.lastResult, failures = _a3.failures;
                var result = wantResults ? results : lastResult;
                if (numFailures === 0)
                  return result;
                throw new BulkError("".concat(_this.name, ".bulkAdd(): ").concat(numFailures, " of ").concat(numObjects, " operations failed"), failures);
              });
            });
          };
          Table2.prototype.bulkPut = function(objects, keysOrOptions, options) {
            var _this = this;
            var keys2 = Array.isArray(keysOrOptions) ? keysOrOptions : void 0;
            options = options || (keys2 ? void 0 : keysOrOptions);
            var wantResults = options ? options.allKeys : void 0;
            return this._trans("readwrite", function(trans) {
              var _a2 = _this.schema.primKey, auto = _a2.auto, keyPath = _a2.keyPath;
              if (keyPath && keys2)
                throw new exceptions.InvalidArgument("bulkPut(): keys argument invalid on tables with inbound keys");
              if (keys2 && keys2.length !== objects.length)
                throw new exceptions.InvalidArgument("Arguments objects and keys must have the same length");
              var numObjects = objects.length;
              var objectsToPut = keyPath && auto ? objects.map(workaroundForUndefinedPrimKey(keyPath)) : objects;
              return _this.core.mutate({
                trans,
                type: "put",
                keys: keys2,
                values: objectsToPut,
                wantResults
              }).then(function(_a3) {
                var numFailures = _a3.numFailures, results = _a3.results, lastResult = _a3.lastResult, failures = _a3.failures;
                var result = wantResults ? results : lastResult;
                if (numFailures === 0)
                  return result;
                throw new BulkError("".concat(_this.name, ".bulkPut(): ").concat(numFailures, " of ").concat(numObjects, " operations failed"), failures);
              });
            });
          };
          Table2.prototype.bulkUpdate = function(keysAndChanges) {
            var _this = this;
            var coreTable = this.core;
            var keys2 = keysAndChanges.map(function(entry) {
              return entry.key;
            });
            var changeSpecs = keysAndChanges.map(function(entry) {
              return entry.changes;
            });
            var offsetMap = [];
            return this._trans("readwrite", function(trans) {
              return coreTable.getMany({ trans, keys: keys2, cache: "clone" }).then(function(objs) {
                var resultKeys = [];
                var resultObjs = [];
                keysAndChanges.forEach(function(_a2, idx) {
                  var key = _a2.key, changes = _a2.changes;
                  var obj = objs[idx];
                  if (obj) {
                    for (var _i = 0, _b = Object.keys(changes); _i < _b.length; _i++) {
                      var keyPath = _b[_i];
                      var value = changes[keyPath];
                      if (keyPath === _this.schema.primKey.keyPath) {
                        if (cmp2(value, key) !== 0) {
                          throw new exceptions.Constraint("Cannot update primary key in bulkUpdate()");
                        }
                      } else {
                        setByKeyPath(obj, keyPath, value);
                      }
                    }
                    offsetMap.push(idx);
                    resultKeys.push(key);
                    resultObjs.push(obj);
                  }
                });
                var numEntries = resultKeys.length;
                return coreTable.mutate({
                  trans,
                  type: "put",
                  keys: resultKeys,
                  values: resultObjs,
                  updates: {
                    keys: keys2,
                    changeSpecs
                  }
                }).then(function(_a2) {
                  var numFailures = _a2.numFailures, failures = _a2.failures;
                  if (numFailures === 0)
                    return numEntries;
                  for (var _i = 0, _b = Object.keys(failures); _i < _b.length; _i++) {
                    var offset = _b[_i];
                    var mappedOffset = offsetMap[Number(offset)];
                    if (mappedOffset != null) {
                      var failure = failures[offset];
                      delete failures[offset];
                      failures[mappedOffset] = failure;
                    }
                  }
                  throw new BulkError("".concat(_this.name, ".bulkUpdate(): ").concat(numFailures, " of ").concat(numEntries, " operations failed"), failures);
                });
              });
            });
          };
          Table2.prototype.bulkDelete = function(keys2) {
            var _this = this;
            var numKeys = keys2.length;
            return this._trans("readwrite", function(trans) {
              return _this.core.mutate({ trans, type: "delete", keys: keys2 }).then(function(res) {
                return builtInDeletionTrigger(_this, keys2, res);
              });
            }).then(function(_a2) {
              var numFailures = _a2.numFailures, lastResult = _a2.lastResult, failures = _a2.failures;
              if (numFailures === 0)
                return lastResult;
              throw new BulkError("".concat(_this.name, ".bulkDelete(): ").concat(numFailures, " of ").concat(numKeys, " operations failed"), failures);
            });
          };
          return Table2;
        })();
        function Events(ctx) {
          var evs = {};
          var rv = function(eventName, subscriber) {
            if (subscriber) {
              var i2 = arguments.length, args = new Array(i2 - 1);
              while (--i2)
                args[i2 - 1] = arguments[i2];
              evs[eventName].subscribe.apply(null, args);
              return ctx;
            } else if (typeof eventName === "string") {
              return evs[eventName];
            }
          };
          rv.addEventType = add3;
          for (var i = 1, l = arguments.length; i < l; ++i) {
            add3(arguments[i]);
          }
          return rv;
          function add3(eventName, chainFunction, defaultFunction) {
            if (typeof eventName === "object")
              return addConfiguredEvents(eventName);
            if (!chainFunction)
              chainFunction = reverseStoppableEventChain;
            if (!defaultFunction)
              defaultFunction = nop;
            var context = {
              subscribers: [],
              fire: defaultFunction,
              subscribe: function(cb) {
                if (context.subscribers.indexOf(cb) === -1) {
                  context.subscribers.push(cb);
                  context.fire = chainFunction(context.fire, cb);
                }
              },
              unsubscribe: function(cb) {
                context.subscribers = context.subscribers.filter(function(fn) {
                  return fn !== cb;
                });
                context.fire = context.subscribers.reduce(chainFunction, defaultFunction);
              }
            };
            evs[eventName] = rv[eventName] = context;
            return context;
          }
          function addConfiguredEvents(cfg) {
            keys(cfg).forEach(function(eventName) {
              var args = cfg[eventName];
              if (isArray(args)) {
                add3(eventName, cfg[eventName][0], cfg[eventName][1]);
              } else if (args === "asap") {
                var context = add3(eventName, mirror, function fire() {
                  var i2 = arguments.length, args2 = new Array(i2);
                  while (i2--)
                    args2[i2] = arguments[i2];
                  context.subscribers.forEach(function(fn) {
                    asap$1(function fireEvent() {
                      fn.apply(null, args2);
                    });
                  });
                });
              } else
                throw new exceptions.InvalidArgument("Invalid event config");
            });
          }
        }
        function makeClassConstructor(prototype, constructor) {
          derive(constructor).from({ prototype });
          return constructor;
        }
        function createTableConstructor(db) {
          return makeClassConstructor(Table.prototype, function Table2(name, tableSchema, trans) {
            this.db = db;
            this._tx = trans;
            this.name = name;
            this.schema = tableSchema;
            this.hook = db._allTables[name] ? db._allTables[name].hook : Events(null, {
              creating: [hookCreatingChain, nop],
              reading: [pureFunctionChain, mirror],
              updating: [hookUpdatingChain, nop],
              deleting: [hookDeletingChain, nop]
            });
          });
        }
        function isPlainKeyRange(ctx, ignoreLimitFilter) {
          return !(ctx.filter || ctx.algorithm || ctx.or) && (ignoreLimitFilter ? ctx.justLimit : !ctx.replayFilter);
        }
        function addFilter(ctx, fn) {
          ctx.filter = combine(ctx.filter, fn);
        }
        function addReplayFilter(ctx, factory, isLimitFilter) {
          var curr = ctx.replayFilter;
          ctx.replayFilter = curr ? function() {
            return combine(curr(), factory());
          } : factory;
          ctx.justLimit = isLimitFilter && !curr;
        }
        function addMatchFilter(ctx, fn) {
          ctx.isMatch = combine(ctx.isMatch, fn);
        }
        function getIndexOrStore(ctx, coreSchema) {
          if (ctx.isPrimKey)
            return coreSchema.primaryKey;
          var index = coreSchema.getIndexByKeyPath(ctx.index);
          if (!index)
            throw new exceptions.Schema("KeyPath " + ctx.index + " on object store " + coreSchema.name + " is not indexed");
          return index;
        }
        function openCursor(ctx, coreTable, trans) {
          var index = getIndexOrStore(ctx, coreTable.schema);
          return coreTable.openCursor({
            trans,
            values: !ctx.keysOnly,
            reverse: ctx.dir === "prev",
            unique: !!ctx.unique,
            query: {
              index,
              range: ctx.range
            }
          });
        }
        function iter(ctx, fn, coreTrans, coreTable) {
          var filter = ctx.replayFilter ? combine(ctx.filter, ctx.replayFilter()) : ctx.filter;
          if (!ctx.or) {
            return iterate(openCursor(ctx, coreTable, coreTrans), combine(ctx.algorithm, filter), fn, !ctx.keysOnly && ctx.valueMapper);
          } else {
            var set_1 = {};
            var union = function(item, cursor, advance) {
              if (!filter || filter(cursor, advance, function(result) {
                return cursor.stop(result);
              }, function(err) {
                return cursor.fail(err);
              })) {
                var primaryKey = cursor.primaryKey;
                var key = "" + primaryKey;
                if (key === "[object ArrayBuffer]")
                  key = "" + new Uint8Array(primaryKey);
                if (!hasOwn(set_1, key)) {
                  set_1[key] = true;
                  fn(item, cursor, advance);
                }
              }
            };
            return Promise.all([
              ctx.or._iterate(union, coreTrans),
              iterate(openCursor(ctx, coreTable, coreTrans), ctx.algorithm, union, !ctx.keysOnly && ctx.valueMapper)
            ]);
          }
        }
        function iterate(cursorPromise, filter, fn, valueMapper) {
          var mappedFn = valueMapper ? function(x, c, a) {
            return fn(valueMapper(x), c, a);
          } : fn;
          var wrappedFn = wrap(mappedFn);
          return cursorPromise.then(function(cursor) {
            if (cursor) {
              return cursor.start(function() {
                var c = function() {
                  return cursor.continue();
                };
                if (!filter || filter(cursor, function(advancer) {
                  return c = advancer;
                }, function(val) {
                  cursor.stop(val);
                  c = nop;
                }, function(e) {
                  cursor.fail(e);
                  c = nop;
                }))
                  wrappedFn(cursor.value, cursor, function(advancer) {
                    return c = advancer;
                  });
                c();
              });
            }
          });
        }
        var Collection = (function() {
          function Collection2() {
          }
          Collection2.prototype._read = function(fn, cb) {
            var ctx = this._ctx;
            return ctx.error ? ctx.table._trans(null, rejection.bind(null, ctx.error)) : ctx.table._trans("readonly", fn).then(cb);
          };
          Collection2.prototype._write = function(fn) {
            var ctx = this._ctx;
            return ctx.error ? ctx.table._trans(null, rejection.bind(null, ctx.error)) : ctx.table._trans("readwrite", fn, "locked");
          };
          Collection2.prototype._addAlgorithm = function(fn) {
            var ctx = this._ctx;
            ctx.algorithm = combine(ctx.algorithm, fn);
          };
          Collection2.prototype._iterate = function(fn, coreTrans) {
            return iter(this._ctx, fn, coreTrans, this._ctx.table.core);
          };
          Collection2.prototype.clone = function(props2) {
            var rv = Object.create(this.constructor.prototype), ctx = Object.create(this._ctx);
            if (props2)
              extend(ctx, props2);
            rv._ctx = ctx;
            return rv;
          };
          Collection2.prototype.raw = function() {
            this._ctx.valueMapper = null;
            return this;
          };
          Collection2.prototype.each = function(fn) {
            var ctx = this._ctx;
            return this._read(function(trans) {
              return iter(ctx, fn, trans, ctx.table.core);
            });
          };
          Collection2.prototype.count = function(cb) {
            var _this = this;
            return this._read(function(trans) {
              var ctx = _this._ctx;
              var coreTable = ctx.table.core;
              if (isPlainKeyRange(ctx, true)) {
                return coreTable.count({
                  trans,
                  query: {
                    index: getIndexOrStore(ctx, coreTable.schema),
                    range: ctx.range
                  }
                }).then(function(count2) {
                  return Math.min(count2, ctx.limit);
                });
              } else {
                var count = 0;
                return iter(ctx, function() {
                  ++count;
                  return false;
                }, trans, coreTable).then(function() {
                  return count;
                });
              }
            }).then(cb);
          };
          Collection2.prototype.sortBy = function(keyPath, cb) {
            var parts = keyPath.split(".").reverse(), lastPart = parts[0], lastIndex = parts.length - 1;
            function getval(obj, i) {
              if (i)
                return getval(obj[parts[i]], i - 1);
              return obj[lastPart];
            }
            var order = this._ctx.dir === "next" ? 1 : -1;
            function sorter(a, b) {
              var aVal = getval(a, lastIndex), bVal = getval(b, lastIndex);
              return cmp2(aVal, bVal) * order;
            }
            return this.toArray(function(a) {
              return a.slice().sort(sorter);
            }).then(cb);
          };
          Collection2.prototype.toArray = function(cb) {
            var _this = this;
            return this._read(function(trans) {
              var ctx = _this._ctx;
              if (isPlainKeyRange(ctx, true) && ctx.limit > 0) {
                var valueMapper_1 = ctx.valueMapper;
                var index = getIndexOrStore(ctx, ctx.table.core.schema);
                return ctx.table.core.query({
                  trans,
                  limit: ctx.limit,
                  values: true,
                  direction: ctx.dir === "prev" ? "prev" : void 0,
                  query: {
                    index,
                    range: ctx.range
                  }
                }).then(function(_a2) {
                  var result = _a2.result;
                  return valueMapper_1 ? result.map(valueMapper_1) : result;
                });
              } else {
                var a_1 = [];
                return iter(ctx, function(item) {
                  return a_1.push(item);
                }, trans, ctx.table.core).then(function() {
                  return a_1;
                });
              }
            }, cb);
          };
          Collection2.prototype.offset = function(offset) {
            var ctx = this._ctx;
            if (offset <= 0)
              return this;
            ctx.offset += offset;
            if (isPlainKeyRange(ctx)) {
              addReplayFilter(ctx, function() {
                var offsetLeft = offset;
                return function(cursor, advance) {
                  if (offsetLeft === 0)
                    return true;
                  if (offsetLeft === 1) {
                    --offsetLeft;
                    return false;
                  }
                  advance(function() {
                    cursor.advance(offsetLeft);
                    offsetLeft = 0;
                  });
                  return false;
                };
              });
            } else {
              addReplayFilter(ctx, function() {
                var offsetLeft = offset;
                return function() {
                  return --offsetLeft < 0;
                };
              });
            }
            return this;
          };
          Collection2.prototype.limit = function(numRows) {
            this._ctx.limit = Math.min(this._ctx.limit, numRows);
            addReplayFilter(this._ctx, function() {
              var rowsLeft = numRows;
              return function(cursor, advance, resolve) {
                if (--rowsLeft <= 0)
                  advance(resolve);
                return rowsLeft >= 0;
              };
            }, true);
            return this;
          };
          Collection2.prototype.until = function(filterFunction, bIncludeStopEntry) {
            addFilter(this._ctx, function(cursor, advance, resolve) {
              if (filterFunction(cursor.value)) {
                advance(resolve);
                return bIncludeStopEntry;
              } else {
                return true;
              }
            });
            return this;
          };
          Collection2.prototype.first = function(cb) {
            return this.limit(1).toArray(function(a) {
              return a[0];
            }).then(cb);
          };
          Collection2.prototype.last = function(cb) {
            return this.reverse().first(cb);
          };
          Collection2.prototype.filter = function(filterFunction) {
            addFilter(this._ctx, function(cursor) {
              return filterFunction(cursor.value);
            });
            addMatchFilter(this._ctx, filterFunction);
            return this;
          };
          Collection2.prototype.and = function(filter) {
            return this.filter(filter);
          };
          Collection2.prototype.or = function(indexName) {
            return new this.db.WhereClause(this._ctx.table, indexName, this);
          };
          Collection2.prototype.reverse = function() {
            this._ctx.dir = this._ctx.dir === "prev" ? "next" : "prev";
            if (this._ondirectionchange)
              this._ondirectionchange(this._ctx.dir);
            return this;
          };
          Collection2.prototype.desc = function() {
            return this.reverse();
          };
          Collection2.prototype.eachKey = function(cb) {
            var ctx = this._ctx;
            ctx.keysOnly = !ctx.isMatch;
            return this.each(function(val, cursor) {
              cb(cursor.key, cursor);
            });
          };
          Collection2.prototype.eachUniqueKey = function(cb) {
            this._ctx.unique = "unique";
            return this.eachKey(cb);
          };
          Collection2.prototype.eachPrimaryKey = function(cb) {
            var ctx = this._ctx;
            ctx.keysOnly = !ctx.isMatch;
            return this.each(function(val, cursor) {
              cb(cursor.primaryKey, cursor);
            });
          };
          Collection2.prototype.keys = function(cb) {
            var ctx = this._ctx;
            ctx.keysOnly = !ctx.isMatch;
            var a = [];
            return this.each(function(item, cursor) {
              a.push(cursor.key);
            }).then(function() {
              return a;
            }).then(cb);
          };
          Collection2.prototype.primaryKeys = function(cb) {
            var ctx = this._ctx;
            if (isPlainKeyRange(ctx, true) && ctx.limit > 0) {
              return this._read(function(trans) {
                var index = getIndexOrStore(ctx, ctx.table.core.schema);
                return ctx.table.core.query({
                  trans,
                  values: false,
                  limit: ctx.limit,
                  direction: ctx.dir === "prev" ? "prev" : void 0,
                  query: {
                    index,
                    range: ctx.range
                  }
                });
              }).then(function(_a2) {
                var result = _a2.result;
                return result;
              }).then(cb);
            }
            ctx.keysOnly = !ctx.isMatch;
            var a = [];
            return this.each(function(item, cursor) {
              a.push(cursor.primaryKey);
            }).then(function() {
              return a;
            }).then(cb);
          };
          Collection2.prototype.uniqueKeys = function(cb) {
            this._ctx.unique = "unique";
            return this.keys(cb);
          };
          Collection2.prototype.firstKey = function(cb) {
            return this.limit(1).keys(function(a) {
              return a[0];
            }).then(cb);
          };
          Collection2.prototype.lastKey = function(cb) {
            return this.reverse().firstKey(cb);
          };
          Collection2.prototype.distinct = function() {
            var ctx = this._ctx, idx = ctx.index && ctx.table.schema.idxByName[ctx.index];
            if (!idx || !idx.multi)
              return this;
            var set = {};
            addFilter(this._ctx, function(cursor) {
              var strKey = cursor.primaryKey.toString();
              var found = hasOwn(set, strKey);
              set[strKey] = true;
              return !found;
            });
            return this;
          };
          Collection2.prototype.modify = function(changes) {
            var _this = this;
            var ctx = this._ctx;
            return this._write(function(trans) {
              var modifyer;
              if (typeof changes === "function") {
                modifyer = changes;
              } else {
                modifyer = function(item) {
                  return applyUpdateSpec(item, changes);
                };
              }
              var coreTable = ctx.table.core;
              var _a2 = coreTable.schema.primaryKey, outbound = _a2.outbound, extractKey = _a2.extractKey;
              var limit = 200;
              var modifyChunkSize = _this.db._options.modifyChunkSize;
              if (modifyChunkSize) {
                if (typeof modifyChunkSize == "object") {
                  limit = modifyChunkSize[coreTable.name] || modifyChunkSize["*"] || 200;
                } else {
                  limit = modifyChunkSize;
                }
              }
              var totalFailures = [];
              var successCount = 0;
              var failedKeys = [];
              var applyMutateResult = function(expectedCount, res) {
                var failures = res.failures, numFailures = res.numFailures;
                successCount += expectedCount - numFailures;
                for (var _i = 0, _a3 = keys(failures); _i < _a3.length; _i++) {
                  var pos = _a3[_i];
                  totalFailures.push(failures[pos]);
                }
              };
              var isUnconditionalDelete = changes === deleteCallback;
              return _this.clone().primaryKeys().then(function(keys2) {
                var criteria = isPlainKeyRange(ctx) && ctx.limit === Infinity && (typeof changes !== "function" || isUnconditionalDelete) && {
                  index: ctx.index,
                  range: ctx.range
                };
                var nextChunk = function(offset) {
                  var count = Math.min(limit, keys2.length - offset);
                  var keysInChunk = keys2.slice(offset, offset + count);
                  return (isUnconditionalDelete ? Promise.resolve([]) : coreTable.getMany({
                    trans,
                    keys: keysInChunk,
                    cache: "immutable"
                  })).then(function(values) {
                    var addValues = [];
                    var putValues = [];
                    var putKeys = outbound ? [] : null;
                    var deleteKeys = isUnconditionalDelete ? keysInChunk : [];
                    if (!isUnconditionalDelete)
                      for (var i = 0; i < count; ++i) {
                        var origValue = values[i];
                        var ctx_1 = {
                          value: deepClone(origValue),
                          primKey: keys2[offset + i]
                        };
                        if (modifyer.call(ctx_1, ctx_1.value, ctx_1) !== false) {
                          if (ctx_1.value == null) {
                            deleteKeys.push(keys2[offset + i]);
                          } else if (!outbound && cmp2(extractKey(origValue), extractKey(ctx_1.value)) !== 0) {
                            deleteKeys.push(keys2[offset + i]);
                            addValues.push(ctx_1.value);
                          } else {
                            putValues.push(ctx_1.value);
                            if (outbound)
                              putKeys.push(keys2[offset + i]);
                          }
                        }
                      }
                    return Promise.resolve(addValues.length > 0 && coreTable.mutate({ trans, type: "add", values: addValues }).then(function(res) {
                      for (var pos in res.failures) {
                        deleteKeys.splice(parseInt(pos), 1);
                      }
                      applyMutateResult(addValues.length, res);
                    })).then(function() {
                      return (putValues.length > 0 || criteria && typeof changes === "object") && coreTable.mutate({
                        trans,
                        type: "put",
                        keys: putKeys,
                        values: putValues,
                        criteria,
                        changeSpec: typeof changes !== "function" && changes,
                        isAdditionalChunk: offset > 0
                      }).then(function(res) {
                        return applyMutateResult(putValues.length, res);
                      });
                    }).then(function() {
                      return (deleteKeys.length > 0 || criteria && isUnconditionalDelete) && coreTable.mutate({
                        trans,
                        type: "delete",
                        keys: deleteKeys,
                        criteria,
                        isAdditionalChunk: offset > 0
                      }).then(function(res) {
                        return builtInDeletionTrigger(ctx.table, deleteKeys, res);
                      }).then(function(res) {
                        return applyMutateResult(deleteKeys.length, res);
                      });
                    }).then(function() {
                      return keys2.length > offset + count && nextChunk(offset + limit);
                    });
                  });
                };
                return nextChunk(0).then(function() {
                  if (totalFailures.length > 0)
                    throw new ModifyError("Error modifying one or more objects", totalFailures, successCount, failedKeys);
                  return keys2.length;
                });
              });
            });
          };
          Collection2.prototype.delete = function() {
            var ctx = this._ctx, range = ctx.range;
            if (isPlainKeyRange(ctx) && !ctx.table.schema.yProps && (ctx.isPrimKey || range.type === 3)) {
              return this._write(function(trans) {
                var primaryKey = ctx.table.core.schema.primaryKey;
                var coreRange = range;
                return ctx.table.core.count({ trans, query: { index: primaryKey, range: coreRange } }).then(function(count) {
                  return ctx.table.core.mutate({ trans, type: "deleteRange", range: coreRange }).then(function(_a2) {
                    var failures = _a2.failures, numFailures = _a2.numFailures;
                    if (numFailures)
                      throw new ModifyError("Could not delete some values", Object.keys(failures).map(function(pos) {
                        return failures[pos];
                      }), count - numFailures);
                    return count - numFailures;
                  });
                });
              });
            }
            return this.modify(deleteCallback);
          };
          return Collection2;
        })();
        var deleteCallback = function(value, ctx) {
          return ctx.value = null;
        };
        function createCollectionConstructor(db) {
          return makeClassConstructor(Collection.prototype, function Collection2(whereClause, keyRangeGenerator) {
            this.db = db;
            var keyRange = AnyRange, error = null;
            if (keyRangeGenerator)
              try {
                keyRange = keyRangeGenerator();
              } catch (ex) {
                error = ex;
              }
            var whereCtx = whereClause._ctx;
            var table = whereCtx.table;
            var readingHook = table.hook.reading.fire;
            this._ctx = {
              table,
              index: whereCtx.index,
              isPrimKey: !whereCtx.index || table.schema.primKey.keyPath && whereCtx.index === table.schema.primKey.name,
              range: keyRange,
              keysOnly: false,
              dir: "next",
              unique: "",
              algorithm: null,
              filter: null,
              replayFilter: null,
              justLimit: true,
              isMatch: null,
              offset: 0,
              limit: Infinity,
              error,
              or: whereCtx.or,
              valueMapper: readingHook !== mirror ? readingHook : null
            };
          });
        }
        function simpleCompare(a, b) {
          return a < b ? -1 : a === b ? 0 : 1;
        }
        function simpleCompareReverse(a, b) {
          return a > b ? -1 : a === b ? 0 : 1;
        }
        function fail(collectionOrWhereClause, err, T) {
          var collection = collectionOrWhereClause instanceof WhereClause ? new collectionOrWhereClause.Collection(collectionOrWhereClause) : collectionOrWhereClause;
          collection._ctx.error = T ? new T(err) : new TypeError(err);
          return collection;
        }
        function emptyCollection(whereClause) {
          return new whereClause.Collection(whereClause, function() {
            return rangeEqual("");
          }).limit(0);
        }
        function upperFactory(dir) {
          return dir === "next" ? function(s) {
            return s.toUpperCase();
          } : function(s) {
            return s.toLowerCase();
          };
        }
        function lowerFactory(dir) {
          return dir === "next" ? function(s) {
            return s.toLowerCase();
          } : function(s) {
            return s.toUpperCase();
          };
        }
        function nextCasing(key, lowerKey, upperNeedle, lowerNeedle, cmp3, dir) {
          var length = Math.min(key.length, lowerNeedle.length);
          var llp = -1;
          for (var i = 0; i < length; ++i) {
            var lwrKeyChar = lowerKey[i];
            if (lwrKeyChar !== lowerNeedle[i]) {
              if (cmp3(key[i], upperNeedle[i]) < 0)
                return key.substr(0, i) + upperNeedle[i] + upperNeedle.substr(i + 1);
              if (cmp3(key[i], lowerNeedle[i]) < 0)
                return key.substr(0, i) + lowerNeedle[i] + upperNeedle.substr(i + 1);
              if (llp >= 0)
                return key.substr(0, llp) + lowerKey[llp] + upperNeedle.substr(llp + 1);
              return null;
            }
            if (cmp3(key[i], lwrKeyChar) < 0)
              llp = i;
          }
          if (length < lowerNeedle.length && dir === "next")
            return key + upperNeedle.substr(key.length);
          if (length < key.length && dir === "prev")
            return key.substr(0, upperNeedle.length);
          return llp < 0 ? null : key.substr(0, llp) + lowerNeedle[llp] + upperNeedle.substr(llp + 1);
        }
        function addIgnoreCaseAlgorithm(whereClause, match, needles, suffix) {
          var upper, lower, compare, upperNeedles, lowerNeedles, direction, nextKeySuffix, needlesLen = needles.length;
          if (!needles.every(function(s) {
            return typeof s === "string";
          })) {
            return fail(whereClause, STRING_EXPECTED);
          }
          function initDirection(dir) {
            upper = upperFactory(dir);
            lower = lowerFactory(dir);
            compare = dir === "next" ? simpleCompare : simpleCompareReverse;
            var needleBounds = needles.map(function(needle) {
              return { lower: lower(needle), upper: upper(needle) };
            }).sort(function(a, b) {
              return compare(a.lower, b.lower);
            });
            upperNeedles = needleBounds.map(function(nb) {
              return nb.upper;
            });
            lowerNeedles = needleBounds.map(function(nb) {
              return nb.lower;
            });
            direction = dir;
            nextKeySuffix = dir === "next" ? "" : suffix;
          }
          initDirection("next");
          var c = new whereClause.Collection(whereClause, function() {
            return createRange(upperNeedles[0], lowerNeedles[needlesLen - 1] + suffix);
          });
          c._ondirectionchange = function(direction2) {
            initDirection(direction2);
          };
          var firstPossibleNeedle = 0;
          c._addAlgorithm(function(cursor, advance, resolve) {
            var key = cursor.key;
            if (typeof key !== "string")
              return false;
            var lowerKey = lower(key);
            if (match(lowerKey, lowerNeedles, firstPossibleNeedle)) {
              return true;
            } else {
              var lowestPossibleCasing = null;
              for (var i = firstPossibleNeedle; i < needlesLen; ++i) {
                var casing = nextCasing(key, lowerKey, upperNeedles[i], lowerNeedles[i], compare, direction);
                if (casing === null && lowestPossibleCasing === null)
                  firstPossibleNeedle = i + 1;
                else if (lowestPossibleCasing === null || compare(lowestPossibleCasing, casing) > 0) {
                  lowestPossibleCasing = casing;
                }
              }
              if (lowestPossibleCasing !== null) {
                advance(function() {
                  cursor.continue(lowestPossibleCasing + nextKeySuffix);
                });
              } else {
                advance(resolve);
              }
              return false;
            }
          });
          return c;
        }
        function createRange(lower, upper, lowerOpen, upperOpen) {
          return {
            type: 2,
            lower,
            upper,
            lowerOpen,
            upperOpen
          };
        }
        function rangeEqual(value) {
          return {
            type: 1,
            lower: value,
            upper: value
          };
        }
        var WhereClause = (function() {
          function WhereClause2() {
          }
          Object.defineProperty(WhereClause2.prototype, "Collection", {
            get: function() {
              return this._ctx.table.db.Collection;
            },
            enumerable: false,
            configurable: true
          });
          WhereClause2.prototype.between = function(lower, upper, includeLower, includeUpper) {
            includeLower = includeLower !== false;
            includeUpper = includeUpper === true;
            try {
              if (this._cmp(lower, upper) > 0 || this._cmp(lower, upper) === 0 && (includeLower || includeUpper) && !(includeLower && includeUpper))
                return emptyCollection(this);
              return new this.Collection(this, function() {
                return createRange(lower, upper, !includeLower, !includeUpper);
              });
            } catch (e) {
              return fail(this, INVALID_KEY_ARGUMENT);
            }
          };
          WhereClause2.prototype.equals = function(value) {
            if (value == null)
              return fail(this, INVALID_KEY_ARGUMENT);
            return new this.Collection(this, function() {
              return rangeEqual(value);
            });
          };
          WhereClause2.prototype.above = function(value) {
            if (value == null)
              return fail(this, INVALID_KEY_ARGUMENT);
            return new this.Collection(this, function() {
              return createRange(value, void 0, true);
            });
          };
          WhereClause2.prototype.aboveOrEqual = function(value) {
            if (value == null)
              return fail(this, INVALID_KEY_ARGUMENT);
            return new this.Collection(this, function() {
              return createRange(value, void 0, false);
            });
          };
          WhereClause2.prototype.below = function(value) {
            if (value == null)
              return fail(this, INVALID_KEY_ARGUMENT);
            return new this.Collection(this, function() {
              return createRange(void 0, value, false, true);
            });
          };
          WhereClause2.prototype.belowOrEqual = function(value) {
            if (value == null)
              return fail(this, INVALID_KEY_ARGUMENT);
            return new this.Collection(this, function() {
              return createRange(void 0, value);
            });
          };
          WhereClause2.prototype.startsWith = function(str) {
            if (typeof str !== "string")
              return fail(this, STRING_EXPECTED);
            return this.between(str, str + maxString, true, true);
          };
          WhereClause2.prototype.startsWithIgnoreCase = function(str) {
            if (str === "")
              return this.startsWith(str);
            return addIgnoreCaseAlgorithm(this, function(x, a) {
              return x.indexOf(a[0]) === 0;
            }, [str], maxString);
          };
          WhereClause2.prototype.equalsIgnoreCase = function(str) {
            return addIgnoreCaseAlgorithm(this, function(x, a) {
              return x === a[0];
            }, [str], "");
          };
          WhereClause2.prototype.anyOfIgnoreCase = function() {
            var set = getArrayOf.apply(NO_CHAR_ARRAY, arguments);
            if (set.length === 0)
              return emptyCollection(this);
            return addIgnoreCaseAlgorithm(this, function(x, a) {
              return a.indexOf(x) !== -1;
            }, set, "");
          };
          WhereClause2.prototype.startsWithAnyOfIgnoreCase = function() {
            var set = getArrayOf.apply(NO_CHAR_ARRAY, arguments);
            if (set.length === 0)
              return emptyCollection(this);
            return addIgnoreCaseAlgorithm(this, function(x, a) {
              return a.some(function(n) {
                return x.indexOf(n) === 0;
              });
            }, set, maxString);
          };
          WhereClause2.prototype.anyOf = function() {
            var _this = this;
            var set = getArrayOf.apply(NO_CHAR_ARRAY, arguments);
            var compare = this._cmp;
            try {
              set.sort(compare);
            } catch (e) {
              return fail(this, INVALID_KEY_ARGUMENT);
            }
            if (set.length === 0)
              return emptyCollection(this);
            var c = new this.Collection(this, function() {
              return createRange(set[0], set[set.length - 1]);
            });
            c._ondirectionchange = function(direction) {
              compare = direction === "next" ? _this._ascending : _this._descending;
              set.sort(compare);
            };
            var i = 0;
            c._addAlgorithm(function(cursor, advance, resolve) {
              var key = cursor.key;
              while (compare(key, set[i]) > 0) {
                ++i;
                if (i === set.length) {
                  advance(resolve);
                  return false;
                }
              }
              if (compare(key, set[i]) === 0) {
                return true;
              } else {
                advance(function() {
                  cursor.continue(set[i]);
                });
                return false;
              }
            });
            return c;
          };
          WhereClause2.prototype.notEqual = function(value) {
            return this.inAnyRange([
              [minKey, value],
              [value, this.db._maxKey]
            ], { includeLowers: false, includeUppers: false });
          };
          WhereClause2.prototype.noneOf = function() {
            var set = getArrayOf.apply(NO_CHAR_ARRAY, arguments);
            if (set.length === 0)
              return new this.Collection(this);
            try {
              set.sort(this._ascending);
            } catch (e) {
              return fail(this, INVALID_KEY_ARGUMENT);
            }
            var ranges = set.reduce(function(res, val) {
              return res ? res.concat([[res[res.length - 1][1], val]]) : [[minKey, val]];
            }, null);
            ranges.push([set[set.length - 1], this.db._maxKey]);
            return this.inAnyRange(ranges, {
              includeLowers: false,
              includeUppers: false
            });
          };
          WhereClause2.prototype.inAnyRange = function(ranges, options) {
            var _this = this;
            var cmp3 = this._cmp, ascending = this._ascending, descending = this._descending, min = this._min, max = this._max;
            if (ranges.length === 0)
              return emptyCollection(this);
            if (!ranges.every(function(range) {
              return range[0] !== void 0 && range[1] !== void 0 && ascending(range[0], range[1]) <= 0;
            })) {
              return fail(this, "First argument to inAnyRange() must be an Array of two-value Arrays [lower,upper] where upper must not be lower than lower", exceptions.InvalidArgument);
            }
            var includeLowers = !options || options.includeLowers !== false;
            var includeUppers = options && options.includeUppers === true;
            function addRange2(ranges2, newRange) {
              var i = 0, l = ranges2.length;
              for (; i < l; ++i) {
                var range = ranges2[i];
                if (cmp3(newRange[0], range[1]) < 0 && cmp3(newRange[1], range[0]) > 0) {
                  range[0] = min(range[0], newRange[0]);
                  range[1] = max(range[1], newRange[1]);
                  break;
                }
              }
              if (i === l)
                ranges2.push(newRange);
              return ranges2;
            }
            var sortDirection = ascending;
            function rangeSorter(a, b) {
              return sortDirection(a[0], b[0]);
            }
            var set;
            try {
              set = ranges.reduce(addRange2, []);
              set.sort(rangeSorter);
            } catch (ex) {
              return fail(this, INVALID_KEY_ARGUMENT);
            }
            var rangePos = 0;
            var keyIsBeyondCurrentEntry = includeUppers ? function(key) {
              return ascending(key, set[rangePos][1]) > 0;
            } : function(key) {
              return ascending(key, set[rangePos][1]) >= 0;
            };
            var keyIsBeforeCurrentEntry = includeLowers ? function(key) {
              return descending(key, set[rangePos][0]) > 0;
            } : function(key) {
              return descending(key, set[rangePos][0]) >= 0;
            };
            function keyWithinCurrentRange(key) {
              return !keyIsBeyondCurrentEntry(key) && !keyIsBeforeCurrentEntry(key);
            }
            var checkKey = keyIsBeyondCurrentEntry;
            var c = new this.Collection(this, function() {
              return createRange(set[0][0], set[set.length - 1][1], !includeLowers, !includeUppers);
            });
            c._ondirectionchange = function(direction) {
              if (direction === "next") {
                checkKey = keyIsBeyondCurrentEntry;
                sortDirection = ascending;
              } else {
                checkKey = keyIsBeforeCurrentEntry;
                sortDirection = descending;
              }
              set.sort(rangeSorter);
            };
            c._addAlgorithm(function(cursor, advance, resolve) {
              var key = cursor.key;
              while (checkKey(key)) {
                ++rangePos;
                if (rangePos === set.length) {
                  advance(resolve);
                  return false;
                }
              }
              if (keyWithinCurrentRange(key)) {
                return true;
              } else if (_this._cmp(key, set[rangePos][1]) === 0 || _this._cmp(key, set[rangePos][0]) === 0) {
                return false;
              } else {
                advance(function() {
                  if (sortDirection === ascending)
                    cursor.continue(set[rangePos][0]);
                  else
                    cursor.continue(set[rangePos][1]);
                });
                return false;
              }
            });
            return c;
          };
          WhereClause2.prototype.startsWithAnyOf = function() {
            var set = getArrayOf.apply(NO_CHAR_ARRAY, arguments);
            if (!set.every(function(s) {
              return typeof s === "string";
            })) {
              return fail(this, "startsWithAnyOf() only works with strings");
            }
            if (set.length === 0)
              return emptyCollection(this);
            return this.inAnyRange(set.map(function(str) {
              return [str, str + maxString];
            }));
          };
          return WhereClause2;
        })();
        function createWhereClauseConstructor(db) {
          return makeClassConstructor(WhereClause.prototype, function WhereClause2(table, index, orCollection) {
            this.db = db;
            this._ctx = {
              table,
              index: index === ":id" ? null : index,
              or: orCollection
            };
            this._cmp = this._ascending = cmp2;
            this._descending = function(a, b) {
              return cmp2(b, a);
            };
            this._max = function(a, b) {
              return cmp2(a, b) > 0 ? a : b;
            };
            this._min = function(a, b) {
              return cmp2(a, b) < 0 ? a : b;
            };
            this._IDBKeyRange = db._deps.IDBKeyRange;
            if (!this._IDBKeyRange)
              throw new exceptions.MissingAPI();
          });
        }
        function eventRejectHandler(reject) {
          return wrap(function(event) {
            preventDefault(event);
            reject(event.target.error);
            return false;
          });
        }
        function preventDefault(event) {
          if (event.stopPropagation)
            event.stopPropagation();
          if (event.preventDefault)
            event.preventDefault();
        }
        var DEXIE_STORAGE_MUTATED_EVENT_NAME = "storagemutated";
        var STORAGE_MUTATED_DOM_EVENT_NAME = "x-storagemutated-1";
        var globalEvents = Events(null, DEXIE_STORAGE_MUTATED_EVENT_NAME);
        var Transaction = (function() {
          function Transaction2() {
          }
          Transaction2.prototype._lock = function() {
            assert(!PSD.global);
            ++this._reculock;
            if (this._reculock === 1 && !PSD.global)
              PSD.lockOwnerFor = this;
            return this;
          };
          Transaction2.prototype._unlock = function() {
            assert(!PSD.global);
            if (--this._reculock === 0) {
              if (!PSD.global)
                PSD.lockOwnerFor = null;
              while (this._blockedFuncs.length > 0 && !this._locked()) {
                var fnAndPSD = this._blockedFuncs.shift();
                try {
                  usePSD(fnAndPSD[1], fnAndPSD[0]);
                } catch (e) {
                }
              }
            }
            return this;
          };
          Transaction2.prototype._locked = function() {
            return this._reculock && PSD.lockOwnerFor !== this;
          };
          Transaction2.prototype.create = function(idbtrans) {
            var _this = this;
            if (!this.mode)
              return this;
            var idbdb = this.db.idbdb;
            var dbOpenError = this.db._state.dbOpenError;
            assert(!this.idbtrans);
            if (!idbtrans && !idbdb) {
              switch (dbOpenError && dbOpenError.name) {
                case "DatabaseClosedError":
                  throw new exceptions.DatabaseClosed(dbOpenError);
                case "MissingAPIError":
                  throw new exceptions.MissingAPI(dbOpenError.message, dbOpenError);
                default:
                  throw new exceptions.OpenFailed(dbOpenError);
              }
            }
            if (!this.active)
              throw new exceptions.TransactionInactive();
            assert(this._completion._state === null);
            idbtrans = this.idbtrans = idbtrans || (this.db.core ? this.db.core.transaction(this.storeNames, this.mode, { durability: this.chromeTransactionDurability }) : idbdb.transaction(this.storeNames, this.mode, {
              durability: this.chromeTransactionDurability
            }));
            idbtrans.onerror = wrap(function(ev) {
              preventDefault(ev);
              _this._reject(idbtrans.error);
            });
            idbtrans.onabort = wrap(function(ev) {
              preventDefault(ev);
              _this.active && _this._reject(new exceptions.Abort(idbtrans.error));
              _this.active = false;
              _this.on("abort").fire(ev);
            });
            idbtrans.oncomplete = wrap(function() {
              _this.active = false;
              _this._resolve();
              if ("mutatedParts" in idbtrans) {
                globalEvents.storagemutated.fire(idbtrans["mutatedParts"]);
              }
            });
            return this;
          };
          Transaction2.prototype._promise = function(mode, fn, bWriteLock) {
            var _this = this;
            if (mode === "readwrite" && this.mode !== "readwrite")
              return rejection(new exceptions.ReadOnly("Transaction is readonly"));
            if (!this.active)
              return rejection(new exceptions.TransactionInactive());
            if (this._locked()) {
              return new DexiePromise(function(resolve, reject) {
                _this._blockedFuncs.push([
                  function() {
                    _this._promise(mode, fn, bWriteLock).then(resolve, reject);
                  },
                  PSD
                ]);
              });
            } else if (bWriteLock) {
              return newScope(function() {
                var p2 = new DexiePromise(function(resolve, reject) {
                  _this._lock();
                  var rv = fn(resolve, reject, _this);
                  if (rv && rv.then)
                    rv.then(resolve, reject);
                });
                p2.finally(function() {
                  return _this._unlock();
                });
                p2._lib = true;
                return p2;
              });
            } else {
              var p = new DexiePromise(function(resolve, reject) {
                var rv = fn(resolve, reject, _this);
                if (rv && rv.then)
                  rv.then(resolve, reject);
              });
              p._lib = true;
              return p;
            }
          };
          Transaction2.prototype._root = function() {
            return this.parent ? this.parent._root() : this;
          };
          Transaction2.prototype.waitFor = function(promiseLike) {
            var root = this._root();
            var promise = DexiePromise.resolve(promiseLike);
            if (root._waitingFor) {
              root._waitingFor = root._waitingFor.then(function() {
                return promise;
              });
            } else {
              root._waitingFor = promise;
              root._waitingQueue = [];
              var store = root.idbtrans.objectStore(root.storeNames[0]);
              (function spin() {
                ++root._spinCount;
                while (root._waitingQueue.length)
                  root._waitingQueue.shift()();
                if (root._waitingFor)
                  store.get(-Infinity).onsuccess = spin;
              })();
            }
            var currentWaitPromise = root._waitingFor;
            return new DexiePromise(function(resolve, reject) {
              promise.then(function(res) {
                return root._waitingQueue.push(wrap(resolve.bind(null, res)));
              }, function(err) {
                return root._waitingQueue.push(wrap(reject.bind(null, err)));
              }).finally(function() {
                if (root._waitingFor === currentWaitPromise) {
                  root._waitingFor = null;
                }
              });
            });
          };
          Transaction2.prototype.abort = function() {
            if (this.active) {
              this.active = false;
              if (this.idbtrans)
                this.idbtrans.abort();
              this._reject(new exceptions.Abort());
            }
          };
          Transaction2.prototype.table = function(tableName) {
            var memoizedTables = this._memoizedTables || (this._memoizedTables = {});
            if (hasOwn(memoizedTables, tableName))
              return memoizedTables[tableName];
            var tableSchema = this.schema[tableName];
            if (!tableSchema) {
              throw new exceptions.NotFound("Table " + tableName + " not part of transaction");
            }
            var transactionBoundTable = new this.db.Table(tableName, tableSchema, this);
            transactionBoundTable.core = this.db.core.table(tableName);
            memoizedTables[tableName] = transactionBoundTable;
            return transactionBoundTable;
          };
          return Transaction2;
        })();
        function createTransactionConstructor(db) {
          return makeClassConstructor(Transaction.prototype, function Transaction2(mode, storeNames, dbschema, chromeTransactionDurability, parent) {
            var _this = this;
            if (mode !== "readonly")
              storeNames.forEach(function(storeName) {
                var _a2;
                var yProps = (_a2 = dbschema[storeName]) === null || _a2 === void 0 ? void 0 : _a2.yProps;
                if (yProps)
                  storeNames = storeNames.concat(yProps.map(function(p) {
                    return p.updatesTable;
                  }));
              });
            this.db = db;
            this.mode = mode;
            this.storeNames = storeNames;
            this.schema = dbschema;
            this.chromeTransactionDurability = chromeTransactionDurability;
            this.idbtrans = null;
            this.on = Events(this, "complete", "error", "abort");
            this.parent = parent || null;
            this.active = true;
            this._reculock = 0;
            this._blockedFuncs = [];
            this._resolve = null;
            this._reject = null;
            this._waitingFor = null;
            this._waitingQueue = null;
            this._spinCount = 0;
            this._completion = new DexiePromise(function(resolve, reject) {
              _this._resolve = resolve;
              _this._reject = reject;
            });
            this._completion.then(function() {
              _this.active = false;
              _this.on.complete.fire();
            }, function(e) {
              var wasActive = _this.active;
              _this.active = false;
              _this.on.error.fire(e);
              _this.parent ? _this.parent._reject(e) : wasActive && _this.idbtrans && _this.idbtrans.abort();
              return rejection(e);
            });
          });
        }
        function createIndexSpec(name, keyPath, unique, multi, auto, compound, isPrimKey, type2) {
          return {
            name,
            keyPath,
            unique,
            multi,
            auto,
            compound,
            src: (unique && !isPrimKey ? "&" : "") + (multi ? "*" : "") + (auto ? "++" : "") + nameFromKeyPath(keyPath),
            type: type2
          };
        }
        function nameFromKeyPath(keyPath) {
          return typeof keyPath === "string" ? keyPath : keyPath ? "[" + [].join.call(keyPath, "+") + "]" : "";
        }
        function createTableSchema(name, primKey, indexes) {
          return {
            name,
            primKey,
            indexes,
            mappedClass: null,
            idxByName: arrayToObject(indexes, function(index) {
              return [index.name, index];
            })
          };
        }
        function safariMultiStoreFix(storeNames) {
          return storeNames.length === 1 ? storeNames[0] : storeNames;
        }
        var getMaxKey = function(IdbKeyRange) {
          try {
            IdbKeyRange.only([[]]);
            getMaxKey = function() {
              return [[]];
            };
            return [[]];
          } catch (e) {
            getMaxKey = function() {
              return maxString;
            };
            return maxString;
          }
        };
        function getKeyExtractor(keyPath) {
          if (keyPath == null) {
            return function() {
              return void 0;
            };
          } else if (typeof keyPath === "string") {
            return getSinglePathKeyExtractor(keyPath);
          } else {
            return function(obj) {
              return getByKeyPath(obj, keyPath);
            };
          }
        }
        function getSinglePathKeyExtractor(keyPath) {
          var split = keyPath.split(".");
          if (split.length === 1) {
            return function(obj) {
              return obj[keyPath];
            };
          } else {
            return function(obj) {
              return getByKeyPath(obj, keyPath);
            };
          }
        }
        function arrayify(arrayLike) {
          return [].slice.call(arrayLike);
        }
        var _id_counter = 0;
        function getKeyPathAlias(keyPath) {
          return keyPath == null ? ":id" : typeof keyPath === "string" ? keyPath : "[".concat(keyPath.join("+"), "]");
        }
        function createDBCore(db, IdbKeyRange, tmpTrans) {
          function extractSchema(db2, trans) {
            var tables2 = arrayify(db2.objectStoreNames);
            var tempStore = tables2.length > 0 ? trans.objectStore(tables2[0]) : {};
            return {
              schema: {
                name: db2.name,
                tables: tables2.map(function(table) {
                  return trans.objectStore(table);
                }).map(function(store) {
                  var keyPath = store.keyPath, autoIncrement = store.autoIncrement;
                  var compound = isArray(keyPath);
                  var outbound = keyPath == null;
                  var indexByKeyPath = {};
                  var result = {
                    name: store.name,
                    primaryKey: {
                      name: null,
                      isPrimaryKey: true,
                      outbound,
                      compound,
                      keyPath,
                      autoIncrement,
                      unique: true,
                      extractKey: getKeyExtractor(keyPath)
                    },
                    indexes: arrayify(store.indexNames).map(function(indexName) {
                      return store.index(indexName);
                    }).map(function(index) {
                      var name = index.name, unique = index.unique, multiEntry = index.multiEntry, keyPath2 = index.keyPath;
                      var compound2 = isArray(keyPath2);
                      var result2 = {
                        name,
                        compound: compound2,
                        keyPath: keyPath2,
                        unique,
                        multiEntry,
                        extractKey: getKeyExtractor(keyPath2)
                      };
                      indexByKeyPath[getKeyPathAlias(keyPath2)] = result2;
                      return result2;
                    }),
                    getIndexByKeyPath: function(keyPath2) {
                      return indexByKeyPath[getKeyPathAlias(keyPath2)];
                    }
                  };
                  indexByKeyPath[":id"] = result.primaryKey;
                  if (keyPath != null) {
                    indexByKeyPath[getKeyPathAlias(keyPath)] = result.primaryKey;
                  }
                  return result;
                })
              },
              hasGetAll: tables2.length > 0 && "getAll" in tempStore && !(typeof navigator !== "undefined" && /Safari/.test(navigator.userAgent) && !/(Chrome\/|Edge\/)/.test(navigator.userAgent) && [].concat(navigator.userAgent.match(/Safari\/(\d*)/))[1] < 604),
              hasIdb3Features: "getAllRecords" in tempStore
            };
          }
          function makeIDBKeyRange(range) {
            if (range.type === 3)
              return null;
            if (range.type === 4)
              throw new Error("Cannot convert never type to IDBKeyRange");
            var lower = range.lower, upper = range.upper, lowerOpen = range.lowerOpen, upperOpen = range.upperOpen;
            var idbRange = lower === void 0 ? upper === void 0 ? null : IdbKeyRange.upperBound(upper, !!upperOpen) : upper === void 0 ? IdbKeyRange.lowerBound(lower, !!lowerOpen) : IdbKeyRange.bound(lower, upper, !!lowerOpen, !!upperOpen);
            return idbRange;
          }
          function createDbCoreTable(tableSchema) {
            var tableName = tableSchema.name;
            function mutate(_a3) {
              var trans = _a3.trans, type2 = _a3.type, keys2 = _a3.keys, values = _a3.values, range = _a3.range;
              return new Promise(function(resolve, reject) {
                resolve = wrap(resolve);
                var store = trans.objectStore(tableName);
                var outbound = store.keyPath == null;
                var isAddOrPut = type2 === "put" || type2 === "add";
                if (!isAddOrPut && type2 !== "delete" && type2 !== "deleteRange")
                  throw new Error("Invalid operation type: " + type2);
                var length = (keys2 || values || { length: 1 }).length;
                if (keys2 && values && keys2.length !== values.length) {
                  throw new Error("Given keys array must have same length as given values array.");
                }
                if (length === 0)
                  return resolve({
                    numFailures: 0,
                    failures: {},
                    results: [],
                    lastResult: void 0
                  });
                var req;
                var reqs = [];
                var failures = [];
                var numFailures = 0;
                var errorHandler = function(event) {
                  ++numFailures;
                  preventDefault(event);
                };
                if (type2 === "deleteRange") {
                  if (range.type === 4)
                    return resolve({
                      numFailures,
                      failures,
                      results: [],
                      lastResult: void 0
                    });
                  if (range.type === 3)
                    reqs.push(req = store.clear());
                  else
                    reqs.push(req = store.delete(makeIDBKeyRange(range)));
                } else {
                  var _a4 = isAddOrPut ? outbound ? [values, keys2] : [values, null] : [keys2, null], args1 = _a4[0], args2 = _a4[1];
                  if (isAddOrPut) {
                    for (var i = 0; i < length; ++i) {
                      reqs.push(req = args2 && args2[i] !== void 0 ? store[type2](args1[i], args2[i]) : store[type2](args1[i]));
                      req.onerror = errorHandler;
                    }
                  } else {
                    for (var i = 0; i < length; ++i) {
                      reqs.push(req = store[type2](args1[i]));
                      req.onerror = errorHandler;
                    }
                  }
                }
                var done = function(event) {
                  var lastResult = event.target.result;
                  reqs.forEach(function(req2, i2) {
                    return req2.error != null && (failures[i2] = req2.error);
                  });
                  resolve({
                    numFailures,
                    failures,
                    results: type2 === "delete" ? keys2 : reqs.map(function(req2) {
                      return req2.result;
                    }),
                    lastResult
                  });
                };
                req.onerror = function(event) {
                  errorHandler(event);
                  done(event);
                };
                req.onsuccess = done;
              });
            }
            function openCursor2(_a3) {
              var trans = _a3.trans, values = _a3.values, query2 = _a3.query, reverse = _a3.reverse, unique = _a3.unique;
              return new Promise(function(resolve, reject) {
                resolve = wrap(resolve);
                var index = query2.index, range = query2.range;
                var store = trans.objectStore(tableName);
                var source = index.isPrimaryKey ? store : store.index(index.name);
                var direction = reverse ? unique ? "prevunique" : "prev" : unique ? "nextunique" : "next";
                var req = values || !("openKeyCursor" in source) ? source.openCursor(makeIDBKeyRange(range), direction) : source.openKeyCursor(makeIDBKeyRange(range), direction);
                req.onerror = eventRejectHandler(reject);
                req.onsuccess = wrap(function(ev) {
                  var cursor = req.result;
                  if (!cursor) {
                    resolve(null);
                    return;
                  }
                  cursor.___id = ++_id_counter;
                  cursor.done = false;
                  var _cursorContinue = cursor.continue.bind(cursor);
                  var _cursorContinuePrimaryKey = cursor.continuePrimaryKey;
                  if (_cursorContinuePrimaryKey)
                    _cursorContinuePrimaryKey = _cursorContinuePrimaryKey.bind(cursor);
                  var _cursorAdvance = cursor.advance.bind(cursor);
                  var doThrowCursorIsNotStarted = function() {
                    throw new Error("Cursor not started");
                  };
                  var doThrowCursorIsStopped = function() {
                    throw new Error("Cursor not stopped");
                  };
                  cursor.trans = trans;
                  cursor.stop = cursor.continue = cursor.continuePrimaryKey = cursor.advance = doThrowCursorIsNotStarted;
                  cursor.fail = wrap(reject);
                  cursor.next = function() {
                    var _this = this;
                    var gotOne = 1;
                    return this.start(function() {
                      return gotOne-- ? _this.continue() : _this.stop();
                    }).then(function() {
                      return _this;
                    });
                  };
                  cursor.start = function(callback) {
                    var iterationPromise = new Promise(function(resolveIteration, rejectIteration) {
                      resolveIteration = wrap(resolveIteration);
                      req.onerror = eventRejectHandler(rejectIteration);
                      cursor.fail = rejectIteration;
                      cursor.stop = function(value) {
                        cursor.stop = cursor.continue = cursor.continuePrimaryKey = cursor.advance = doThrowCursorIsStopped;
                        resolveIteration(value);
                      };
                    });
                    var guardedCallback = function() {
                      if (req.result) {
                        try {
                          callback();
                        } catch (err) {
                          cursor.fail(err);
                        }
                      } else {
                        cursor.done = true;
                        cursor.start = function() {
                          throw new Error("Cursor behind last entry");
                        };
                        cursor.stop();
                      }
                    };
                    req.onsuccess = wrap(function(ev2) {
                      req.onsuccess = guardedCallback;
                      guardedCallback();
                    });
                    cursor.continue = _cursorContinue;
                    cursor.continuePrimaryKey = _cursorContinuePrimaryKey;
                    cursor.advance = _cursorAdvance;
                    guardedCallback();
                    return iterationPromise;
                  };
                  resolve(cursor);
                }, reject);
              });
            }
            function query(hasGetAll2, hasIdb3Features2) {
              return function(request) {
                return new Promise(function(resolve, reject) {
                  var _a3;
                  resolve = wrap(resolve);
                  var trans = request.trans, values = request.values, limit = request.limit, query2 = request.query;
                  var direction = (_a3 = request.direction) !== null && _a3 !== void 0 ? _a3 : "next";
                  var nonInfinitLimit = limit === Infinity ? void 0 : limit;
                  var index = query2.index, range = query2.range;
                  var store = trans.objectStore(tableName);
                  var source = index.isPrimaryKey ? store : store.index(index.name);
                  var idbKeyRange = makeIDBKeyRange(range);
                  if (limit === 0)
                    return resolve({ result: [] });
                  if (hasIdb3Features2) {
                    var options = {
                      query: idbKeyRange,
                      count: nonInfinitLimit,
                      direction
                    };
                    var req = values ? source.getAll(options) : source.getAllKeys(options);
                    req.onsuccess = function(event) {
                      return resolve({ result: event.target.result });
                    };
                    req.onerror = eventRejectHandler(reject);
                  } else if (hasGetAll2 && direction === "next") {
                    var req = values ? source.getAll(idbKeyRange, nonInfinitLimit) : source.getAllKeys(idbKeyRange, nonInfinitLimit);
                    req.onsuccess = function(event) {
                      return resolve({ result: event.target.result });
                    };
                    req.onerror = eventRejectHandler(reject);
                  } else {
                    var count_1 = 0;
                    var req_1 = values || !("openKeyCursor" in source) ? source.openCursor(idbKeyRange, direction) : source.openKeyCursor(idbKeyRange, direction);
                    var result_1 = [];
                    req_1.onsuccess = function() {
                      var cursor = req_1.result;
                      if (!cursor)
                        return resolve({ result: result_1 });
                      result_1.push(values ? cursor.value : cursor.primaryKey);
                      if (++count_1 === limit)
                        return resolve({ result: result_1 });
                      cursor.continue();
                    };
                    req_1.onerror = eventRejectHandler(reject);
                  }
                });
              };
            }
            return {
              name: tableName,
              schema: tableSchema,
              mutate,
              getMany: function(_a3) {
                var trans = _a3.trans, keys2 = _a3.keys;
                return new Promise(function(resolve, reject) {
                  resolve = wrap(resolve);
                  var store = trans.objectStore(tableName);
                  var length = keys2.length;
                  var result = new Array(length);
                  var keyCount = 0;
                  var callbackCount = 0;
                  var req;
                  var successHandler = function(event) {
                    var req2 = event.target;
                    if ((result[req2._pos] = req2.result) != null)
                      ;
                    if (++callbackCount === keyCount)
                      resolve(result);
                  };
                  var errorHandler = eventRejectHandler(reject);
                  for (var i = 0; i < length; ++i) {
                    var key = keys2[i];
                    if (key != null) {
                      req = store.get(keys2[i]);
                      req._pos = i;
                      req.onsuccess = successHandler;
                      req.onerror = errorHandler;
                      ++keyCount;
                    }
                  }
                  if (keyCount === 0)
                    resolve(result);
                });
              },
              get: function(_a3) {
                var trans = _a3.trans, key = _a3.key;
                return new Promise(function(resolve, reject) {
                  resolve = wrap(resolve);
                  var store = trans.objectStore(tableName);
                  var req = store.get(key);
                  req.onsuccess = function(event) {
                    return resolve(event.target.result);
                  };
                  req.onerror = eventRejectHandler(reject);
                });
              },
              query: query(hasGetAll, hasIdb3Features),
              openCursor: openCursor2,
              count: function(_a3) {
                var query2 = _a3.query, trans = _a3.trans;
                var index = query2.index, range = query2.range;
                return new Promise(function(resolve, reject) {
                  var store = trans.objectStore(tableName);
                  var source = index.isPrimaryKey ? store : store.index(index.name);
                  var idbKeyRange = makeIDBKeyRange(range);
                  var req = idbKeyRange ? source.count(idbKeyRange) : source.count();
                  req.onsuccess = wrap(function(ev) {
                    return resolve(ev.target.result);
                  });
                  req.onerror = eventRejectHandler(reject);
                });
              }
            };
          }
          var _a2 = extractSchema(db, tmpTrans), schema = _a2.schema, hasGetAll = _a2.hasGetAll, hasIdb3Features = _a2.hasIdb3Features;
          var tables = schema.tables.map(function(tableSchema) {
            return createDbCoreTable(tableSchema);
          });
          var tableMap = {};
          tables.forEach(function(table) {
            return tableMap[table.name] = table;
          });
          return {
            stack: "dbcore",
            transaction: db.transaction.bind(db),
            table: function(name) {
              var result = tableMap[name];
              if (!result)
                throw new Error("Table '".concat(name, "' not found"));
              return tableMap[name];
            },
            MIN_KEY: -Infinity,
            MAX_KEY: getMaxKey(IdbKeyRange),
            schema
          };
        }
        function createMiddlewareStack(stackImpl, middlewares) {
          return middlewares.reduce(function(down, _a2) {
            var create = _a2.create;
            return __assign(__assign({}, down), create(down));
          }, stackImpl);
        }
        function createMiddlewareStacks(middlewares, idbdb, _a2, tmpTrans) {
          var IDBKeyRange = _a2.IDBKeyRange;
          _a2.indexedDB;
          var dbcore = createMiddlewareStack(createDBCore(idbdb, IDBKeyRange, tmpTrans), middlewares.dbcore);
          return {
            dbcore
          };
        }
        function generateMiddlewareStacks(db, tmpTrans) {
          var idbdb = tmpTrans.db;
          var stacks = createMiddlewareStacks(db._middlewares, idbdb, db._deps, tmpTrans);
          db.core = stacks.dbcore;
          db.tables.forEach(function(table) {
            var tableName = table.name;
            if (db.core.schema.tables.some(function(tbl) {
              return tbl.name === tableName;
            })) {
              table.core = db.core.table(tableName);
              if (db[tableName] instanceof db.Table) {
                db[tableName].core = table.core;
              }
            }
          });
        }
        function setApiOnPlace(db, objs, tableNames, dbschema) {
          tableNames.forEach(function(tableName) {
            var schema = dbschema[tableName];
            objs.forEach(function(obj) {
              var propDesc = getPropertyDescriptor(obj, tableName);
              if (!propDesc || "value" in propDesc && propDesc.value === void 0) {
                if (obj === db.Transaction.prototype || obj instanceof db.Transaction) {
                  setProp(obj, tableName, {
                    get: function() {
                      return this.table(tableName);
                    },
                    set: function(value) {
                      defineProperty(this, tableName, {
                        value,
                        writable: true,
                        configurable: true,
                        enumerable: true
                      });
                    }
                  });
                } else {
                  obj[tableName] = new db.Table(tableName, schema);
                }
              }
            });
          });
        }
        function removeTablesApi(db, objs) {
          objs.forEach(function(obj) {
            for (var key in obj) {
              if (obj[key] instanceof db.Table)
                delete obj[key];
            }
          });
        }
        function lowerVersionFirst(a, b) {
          return a._cfg.version - b._cfg.version;
        }
        function runUpgraders(db, oldVersion, idbUpgradeTrans, reject) {
          var globalSchema = db._dbSchema;
          if (idbUpgradeTrans.objectStoreNames.contains("$meta") && !globalSchema.$meta) {
            globalSchema.$meta = createTableSchema("$meta", parseIndexSyntax("")[0], []);
            db._storeNames.push("$meta");
          }
          var trans = db._createTransaction("readwrite", db._storeNames, globalSchema);
          trans.create(idbUpgradeTrans);
          trans._completion.catch(reject);
          var rejectTransaction = trans._reject.bind(trans);
          var transless = PSD.transless || PSD;
          newScope(function() {
            PSD.trans = trans;
            PSD.transless = transless;
            if (oldVersion === 0) {
              keys(globalSchema).forEach(function(tableName) {
                createTable(idbUpgradeTrans, tableName, globalSchema[tableName].primKey, globalSchema[tableName].indexes);
              });
              generateMiddlewareStacks(db, idbUpgradeTrans);
              DexiePromise.follow(function() {
                return db.on.populate.fire(trans);
              }).catch(rejectTransaction);
            } else {
              generateMiddlewareStacks(db, idbUpgradeTrans);
              return getExistingVersion(db, trans, oldVersion).then(function(oldVersion2) {
                return updateTablesAndIndexes(db, oldVersion2, trans, idbUpgradeTrans);
              }).catch(rejectTransaction);
            }
          });
        }
        function patchCurrentVersion(db, idbUpgradeTrans) {
          createMissingTables(db._dbSchema, idbUpgradeTrans);
          if (idbUpgradeTrans.db.version % 10 === 0 && !idbUpgradeTrans.objectStoreNames.contains("$meta")) {
            idbUpgradeTrans.db.createObjectStore("$meta").add(Math.ceil(idbUpgradeTrans.db.version / 10 - 1), "version");
          }
          var globalSchema = buildGlobalSchema(db, db.idbdb, idbUpgradeTrans);
          adjustToExistingIndexNames(db, db._dbSchema, idbUpgradeTrans);
          var diff = getSchemaDiff(globalSchema, db._dbSchema);
          var _loop_1 = function(tableChange2) {
            if (tableChange2.change.length || tableChange2.recreate) {
              console.warn("Unable to patch indexes of table ".concat(tableChange2.name, " because it has changes on the type of index or primary key."));
              return { value: void 0 };
            }
            var store = idbUpgradeTrans.objectStore(tableChange2.name);
            tableChange2.add.forEach(function(idx) {
              if (debug)
                console.debug("Dexie upgrade patch: Creating missing index ".concat(tableChange2.name, ".").concat(idx.src));
              addIndex(store, idx);
            });
          };
          for (var _i = 0, _a2 = diff.change; _i < _a2.length; _i++) {
            var tableChange = _a2[_i];
            var state_1 = _loop_1(tableChange);
            if (typeof state_1 === "object")
              return state_1.value;
          }
        }
        function getExistingVersion(db, trans, oldVersion) {
          if (trans.storeNames.includes("$meta")) {
            return trans.table("$meta").get("version").then(function(metaVersion) {
              return metaVersion != null ? metaVersion : oldVersion;
            });
          } else {
            return DexiePromise.resolve(oldVersion);
          }
        }
        function updateTablesAndIndexes(db, oldVersion, trans, idbUpgradeTrans) {
          var queue = [];
          var versions = db._versions;
          var globalSchema = db._dbSchema = buildGlobalSchema(db, db.idbdb, idbUpgradeTrans);
          var versToRun = versions.filter(function(v) {
            return v._cfg.version >= oldVersion;
          });
          if (versToRun.length === 0) {
            return DexiePromise.resolve();
          }
          versToRun.forEach(function(version2) {
            queue.push(function() {
              var oldSchema = globalSchema;
              var newSchema = version2._cfg.dbschema;
              adjustToExistingIndexNames(db, oldSchema, idbUpgradeTrans);
              adjustToExistingIndexNames(db, newSchema, idbUpgradeTrans);
              globalSchema = db._dbSchema = newSchema;
              var diff = getSchemaDiff(oldSchema, newSchema);
              diff.add.forEach(function(tuple) {
                createTable(idbUpgradeTrans, tuple[0], tuple[1].primKey, tuple[1].indexes);
              });
              diff.change.forEach(function(change) {
                if (change.recreate) {
                  throw new exceptions.Upgrade("Not yet support for changing primary key");
                } else {
                  var store_1 = idbUpgradeTrans.objectStore(change.name);
                  change.add.forEach(function(idx) {
                    return addIndex(store_1, idx);
                  });
                  change.change.forEach(function(idx) {
                    store_1.deleteIndex(idx.name);
                    addIndex(store_1, idx);
                  });
                  change.del.forEach(function(idxName) {
                    return store_1.deleteIndex(idxName);
                  });
                }
              });
              var contentUpgrade = version2._cfg.contentUpgrade;
              if (contentUpgrade && version2._cfg.version > oldVersion) {
                generateMiddlewareStacks(db, idbUpgradeTrans);
                trans._memoizedTables = {};
                var upgradeSchema_1 = shallowClone(newSchema);
                diff.del.forEach(function(table) {
                  upgradeSchema_1[table] = oldSchema[table];
                });
                removeTablesApi(db, [db.Transaction.prototype]);
                setApiOnPlace(db, [db.Transaction.prototype], keys(upgradeSchema_1), upgradeSchema_1);
                trans.schema = upgradeSchema_1;
                var contentUpgradeIsAsync_1 = isAsyncFunction(contentUpgrade);
                if (contentUpgradeIsAsync_1) {
                  incrementExpectedAwaits();
                }
                var returnValue_1;
                var promiseFollowed = DexiePromise.follow(function() {
                  returnValue_1 = contentUpgrade(trans);
                  if (returnValue_1) {
                    if (contentUpgradeIsAsync_1) {
                      var decrementor = decrementExpectedAwaits.bind(null, null);
                      returnValue_1.then(decrementor, decrementor);
                    }
                  }
                });
                return returnValue_1 && typeof returnValue_1.then === "function" ? DexiePromise.resolve(returnValue_1) : promiseFollowed.then(function() {
                  return returnValue_1;
                });
              }
            });
            queue.push(function(idbtrans) {
              var newSchema = version2._cfg.dbschema;
              deleteRemovedTables(newSchema, idbtrans);
              removeTablesApi(db, [db.Transaction.prototype]);
              setApiOnPlace(db, [db.Transaction.prototype], db._storeNames, db._dbSchema);
              trans.schema = db._dbSchema;
            });
            queue.push(function(idbtrans) {
              if (db.idbdb.objectStoreNames.contains("$meta")) {
                if (Math.ceil(db.idbdb.version / 10) === version2._cfg.version) {
                  db.idbdb.deleteObjectStore("$meta");
                  delete db._dbSchema.$meta;
                  db._storeNames = db._storeNames.filter(function(name) {
                    return name !== "$meta";
                  });
                } else {
                  idbtrans.objectStore("$meta").put(version2._cfg.version, "version");
                }
              }
            });
          });
          function runQueue() {
            return queue.length ? DexiePromise.resolve(queue.shift()(trans.idbtrans)).then(runQueue) : DexiePromise.resolve();
          }
          return runQueue().then(function() {
            createMissingTables(globalSchema, idbUpgradeTrans);
          });
        }
        function getSchemaDiff(oldSchema, newSchema) {
          var diff = {
            del: [],
            add: [],
            change: []
          };
          var table;
          for (table in oldSchema) {
            if (!newSchema[table])
              diff.del.push(table);
          }
          for (table in newSchema) {
            var oldDef = oldSchema[table], newDef = newSchema[table];
            if (!oldDef) {
              diff.add.push([table, newDef]);
            } else {
              var change = {
                name: table,
                def: newDef,
                recreate: false,
                del: [],
                add: [],
                change: []
              };
              if ("" + (oldDef.primKey.keyPath || "") !== "" + (newDef.primKey.keyPath || "") || oldDef.primKey.auto !== newDef.primKey.auto) {
                change.recreate = true;
                diff.change.push(change);
              } else {
                var oldIndexes = oldDef.idxByName;
                var newIndexes = newDef.idxByName;
                var idxName = void 0;
                for (idxName in oldIndexes) {
                  if (!newIndexes[idxName])
                    change.del.push(idxName);
                }
                for (idxName in newIndexes) {
                  var oldIdx = oldIndexes[idxName], newIdx = newIndexes[idxName];
                  if (!oldIdx)
                    change.add.push(newIdx);
                  else if (oldIdx.src !== newIdx.src)
                    change.change.push(newIdx);
                }
                if (change.del.length > 0 || change.add.length > 0 || change.change.length > 0) {
                  diff.change.push(change);
                }
              }
            }
          }
          return diff;
        }
        function createTable(idbtrans, tableName, primKey, indexes) {
          var store = idbtrans.db.createObjectStore(tableName, primKey.keyPath ? { keyPath: primKey.keyPath, autoIncrement: primKey.auto } : { autoIncrement: primKey.auto });
          indexes.forEach(function(idx) {
            return addIndex(store, idx);
          });
          return store;
        }
        function createMissingTables(newSchema, idbtrans) {
          keys(newSchema).forEach(function(tableName) {
            if (!idbtrans.db.objectStoreNames.contains(tableName)) {
              if (debug)
                console.debug("Dexie: Creating missing table", tableName);
              createTable(idbtrans, tableName, newSchema[tableName].primKey, newSchema[tableName].indexes);
            }
          });
        }
        function deleteRemovedTables(newSchema, idbtrans) {
          [].slice.call(idbtrans.db.objectStoreNames).forEach(function(storeName) {
            return newSchema[storeName] == null && idbtrans.db.deleteObjectStore(storeName);
          });
        }
        function addIndex(store, idx) {
          store.createIndex(idx.name, idx.keyPath, {
            unique: idx.unique,
            multiEntry: idx.multi
          });
        }
        function buildGlobalSchema(db, idbdb, tmpTrans) {
          var globalSchema = {};
          var dbStoreNames = slice(idbdb.objectStoreNames, 0);
          dbStoreNames.forEach(function(storeName) {
            var store = tmpTrans.objectStore(storeName);
            var keyPath = store.keyPath;
            var primKey = createIndexSpec(nameFromKeyPath(keyPath), keyPath || "", true, false, !!store.autoIncrement, keyPath && typeof keyPath !== "string", true);
            var indexes = [];
            for (var j = 0; j < store.indexNames.length; ++j) {
              var idbindex = store.index(store.indexNames[j]);
              keyPath = idbindex.keyPath;
              var index = createIndexSpec(idbindex.name, keyPath, !!idbindex.unique, !!idbindex.multiEntry, false, keyPath && typeof keyPath !== "string", false);
              indexes.push(index);
            }
            globalSchema[storeName] = createTableSchema(storeName, primKey, indexes);
          });
          return globalSchema;
        }
        function readGlobalSchema(db, idbdb, tmpTrans) {
          db.verno = idbdb.version / 10;
          var globalSchema = db._dbSchema = buildGlobalSchema(db, idbdb, tmpTrans);
          db._storeNames = slice(idbdb.objectStoreNames, 0);
          setApiOnPlace(db, [db._allTables], keys(globalSchema), globalSchema);
        }
        function verifyInstalledSchema(db, tmpTrans) {
          var installedSchema = buildGlobalSchema(db, db.idbdb, tmpTrans);
          var diff = getSchemaDiff(installedSchema, db._dbSchema);
          return !(diff.add.length || diff.change.some(function(ch) {
            return ch.add.length || ch.change.length;
          }));
        }
        function adjustToExistingIndexNames(db, schema, idbtrans) {
          var storeNames = idbtrans.db.objectStoreNames;
          for (var i = 0; i < storeNames.length; ++i) {
            var storeName = storeNames[i];
            var store = idbtrans.objectStore(storeName);
            db._hasGetAll = "getAll" in store;
            for (var j = 0; j < store.indexNames.length; ++j) {
              var indexName = store.indexNames[j];
              var keyPath = store.index(indexName).keyPath;
              var dexieName = typeof keyPath === "string" ? keyPath : "[" + slice(keyPath).join("+") + "]";
              if (schema[storeName]) {
                var indexSpec = schema[storeName].idxByName[dexieName];
                if (indexSpec) {
                  indexSpec.name = indexName;
                  delete schema[storeName].idxByName[dexieName];
                  schema[storeName].idxByName[indexName] = indexSpec;
                }
              }
            }
          }
          if (typeof navigator !== "undefined" && /Safari/.test(navigator.userAgent) && !/(Chrome\/|Edge\/)/.test(navigator.userAgent) && _global.WorkerGlobalScope && _global instanceof _global.WorkerGlobalScope && [].concat(navigator.userAgent.match(/Safari\/(\d*)/))[1] < 604) {
            db._hasGetAll = false;
          }
        }
        function parseIndexSyntax(primKeyAndIndexes) {
          return primKeyAndIndexes.split(",").map(function(index, indexNum) {
            var _a2;
            var typeSplit = index.split(":");
            var type2 = (_a2 = typeSplit[1]) === null || _a2 === void 0 ? void 0 : _a2.trim();
            index = typeSplit[0].trim();
            var name = index.replace(/([&*]|\+\+)/g, "");
            var keyPath = /^\[/.test(name) ? name.match(/^\[(.*)\]$/)[1].split("+") : name;
            return createIndexSpec(name, keyPath || null, /\&/.test(index), /\*/.test(index), /\+\+/.test(index), isArray(keyPath), indexNum === 0, type2);
          });
        }
        var Version = (function() {
          function Version2() {
          }
          Version2.prototype._createTableSchema = function(name, primKey, indexes) {
            return createTableSchema(name, primKey, indexes);
          };
          Version2.prototype._parseIndexSyntax = function(primKeyAndIndexes) {
            return parseIndexSyntax(primKeyAndIndexes);
          };
          Version2.prototype._parseStoresSpec = function(stores, outSchema) {
            var _this = this;
            keys(stores).forEach(function(tableName) {
              if (stores[tableName] !== null) {
                var indexes = _this._parseIndexSyntax(stores[tableName]);
                var primKey = indexes.shift();
                if (!primKey) {
                  throw new exceptions.Schema("Invalid schema for table " + tableName + ": " + stores[tableName]);
                }
                primKey.unique = true;
                if (primKey.multi)
                  throw new exceptions.Schema("Primary key cannot be multiEntry*");
                indexes.forEach(function(idx) {
                  if (idx.auto)
                    throw new exceptions.Schema("Only primary key can be marked as autoIncrement (++)");
                  if (!idx.keyPath)
                    throw new exceptions.Schema("Index must have a name and cannot be an empty string");
                });
                var tblSchema = _this._createTableSchema(tableName, primKey, indexes);
                outSchema[tableName] = tblSchema;
              }
            });
          };
          Version2.prototype.stores = function(stores) {
            var db = this.db;
            this._cfg.storesSource = this._cfg.storesSource ? extend(this._cfg.storesSource, stores) : stores;
            var versions = db._versions;
            var storesSpec = {};
            var dbschema = {};
            versions.forEach(function(version2) {
              extend(storesSpec, version2._cfg.storesSource);
              dbschema = version2._cfg.dbschema = {};
              version2._parseStoresSpec(storesSpec, dbschema);
            });
            db._dbSchema = dbschema;
            removeTablesApi(db, [db._allTables, db, db.Transaction.prototype]);
            setApiOnPlace(db, [db._allTables, db, db.Transaction.prototype, this._cfg.tables], keys(dbschema), dbschema);
            db._storeNames = keys(dbschema);
            return this;
          };
          Version2.prototype.upgrade = function(upgradeFunction) {
            this._cfg.contentUpgrade = promisableChain(this._cfg.contentUpgrade || nop, upgradeFunction);
            return this;
          };
          return Version2;
        })();
        function createVersionConstructor(db) {
          return makeClassConstructor(Version.prototype, function Version2(versionNumber) {
            this.db = db;
            this._cfg = {
              version: versionNumber,
              storesSource: null,
              dbschema: {},
              tables: {},
              contentUpgrade: null
            };
          });
        }
        var connections = createConnectionsManager();
        function createConnectionsManager() {
          if (typeof FinalizationRegistry !== "undefined" && typeof WeakRef !== "undefined") {
            var _refs_1 = /* @__PURE__ */ new Set();
            var _registry_1 = new FinalizationRegistry(function(ref) {
              _refs_1.delete(ref);
            });
            var toArray = function() {
              return Array.from(_refs_1).map(function(ref) {
                return ref.deref();
              }).filter(function(db) {
                return db !== void 0;
              });
            };
            var add3 = function(db) {
              var ref = new WeakRef(db._novip);
              _refs_1.add(ref);
              _registry_1.register(db._novip, ref, ref);
              if (_refs_1.size > db._options.maxConnections) {
                var oldestRef = _refs_1.values().next().value;
                _refs_1.delete(oldestRef);
                _registry_1.unregister(oldestRef);
              }
            };
            var remove3 = function(db) {
              if (!db)
                return;
              var iterator = _refs_1.values();
              var result = iterator.next();
              while (!result.done) {
                var ref = result.value;
                if (ref.deref() === db._novip) {
                  _refs_1.delete(ref);
                  _registry_1.unregister(ref);
                  return;
                }
                result = iterator.next();
              }
            };
            return { toArray, add: add3, remove: remove3 };
          } else {
            var connections_1 = [];
            var toArray = function() {
              return connections_1;
            };
            var add3 = function(db) {
              connections_1.push(db._novip);
            };
            var remove3 = function(db) {
              if (!db)
                return;
              var index = connections_1.indexOf(db._novip);
              if (index !== -1) {
                connections_1.splice(index, 1);
              }
            };
            return { toArray, add: add3, remove: remove3 };
          }
        }
        function getDbNamesTable(indexedDB2, IDBKeyRange) {
          var dbNamesDB = indexedDB2["_dbNamesDB"];
          if (!dbNamesDB) {
            dbNamesDB = indexedDB2["_dbNamesDB"] = new Dexie$1(DBNAMES_DB, {
              addons: [],
              indexedDB: indexedDB2,
              IDBKeyRange
            });
            dbNamesDB.version(1).stores({ dbnames: "name" });
          }
          return dbNamesDB.table("dbnames");
        }
        function hasDatabasesNative(indexedDB2) {
          return indexedDB2 && typeof indexedDB2.databases === "function";
        }
        function getDatabaseNames(_a2) {
          var indexedDB2 = _a2.indexedDB, IDBKeyRange = _a2.IDBKeyRange;
          return hasDatabasesNative(indexedDB2) ? Promise.resolve(indexedDB2.databases()).then(function(infos) {
            return infos.map(function(info) {
              return info.name;
            }).filter(function(name) {
              return name !== DBNAMES_DB;
            });
          }) : getDbNamesTable(indexedDB2, IDBKeyRange).toCollection().primaryKeys();
        }
        function _onDatabaseCreated(_a2, name) {
          var indexedDB2 = _a2.indexedDB, IDBKeyRange = _a2.IDBKeyRange;
          !hasDatabasesNative(indexedDB2) && name !== DBNAMES_DB && getDbNamesTable(indexedDB2, IDBKeyRange).put({ name }).catch(nop);
        }
        function _onDatabaseDeleted(_a2, name) {
          var indexedDB2 = _a2.indexedDB, IDBKeyRange = _a2.IDBKeyRange;
          !hasDatabasesNative(indexedDB2) && name !== DBNAMES_DB && getDbNamesTable(indexedDB2, IDBKeyRange).delete(name).catch(nop);
        }
        function vip(fn) {
          return newScope(function() {
            PSD.letThrough = true;
            return fn();
          });
        }
        function idbReady() {
          var isSafari = !navigator.userAgentData && /Safari\//.test(navigator.userAgent) && !/Chrom(e|ium)\//.test(navigator.userAgent);
          if (!isSafari || !indexedDB.databases)
            return Promise.resolve();
          var intervalId;
          return new Promise(function(resolve) {
            var tryIdb = function() {
              return indexedDB.databases().finally(resolve);
            };
            intervalId = setInterval(tryIdb, 100);
            tryIdb();
          }).finally(function() {
            return clearInterval(intervalId);
          });
        }
        var _a;
        function isEmptyRange(node) {
          return !("from" in node);
        }
        var RangeSet2 = function(fromOrTree, to) {
          if (this) {
            extend(this, arguments.length ? { d: 1, from: fromOrTree, to: arguments.length > 1 ? to : fromOrTree } : { d: 0 });
          } else {
            var rv = new RangeSet2();
            if (fromOrTree && "d" in fromOrTree) {
              extend(rv, fromOrTree);
            }
            return rv;
          }
        };
        props(RangeSet2.prototype, (_a = {
          add: function(rangeSet) {
            mergeRanges2(this, rangeSet);
            return this;
          },
          addKey: function(key) {
            addRange(this, key, key);
            return this;
          },
          addKeys: function(keys2) {
            var _this = this;
            keys2.forEach(function(key) {
              return addRange(_this, key, key);
            });
            return this;
          },
          hasKey: function(key) {
            var node = getRangeSetIterator(this).next(key).value;
            return node && cmp2(node.from, key) <= 0 && cmp2(node.to, key) >= 0;
          }
        }, _a[iteratorSymbol] = function() {
          return getRangeSetIterator(this);
        }, _a));
        function addRange(target, from, to) {
          var diff = cmp2(from, to);
          if (isNaN(diff))
            return;
          if (diff > 0)
            throw RangeError();
          if (isEmptyRange(target))
            return extend(target, { from, to, d: 1 });
          var left = target.l;
          var right = target.r;
          if (cmp2(to, target.from) < 0) {
            left ? addRange(left, from, to) : target.l = { from, to, d: 1, l: null, r: null };
            return rebalance(target);
          }
          if (cmp2(from, target.to) > 0) {
            right ? addRange(right, from, to) : target.r = { from, to, d: 1, l: null, r: null };
            return rebalance(target);
          }
          if (cmp2(from, target.from) < 0) {
            target.from = from;
            target.l = null;
            target.d = right ? right.d + 1 : 1;
          }
          if (cmp2(to, target.to) > 0) {
            target.to = to;
            target.r = null;
            target.d = target.l ? target.l.d + 1 : 1;
          }
          var rightWasCutOff = !target.r;
          if (left && !target.l) {
            mergeRanges2(target, left);
          }
          if (right && rightWasCutOff) {
            mergeRanges2(target, right);
          }
        }
        function mergeRanges2(target, newSet) {
          function _addRangeSet(target2, _a2) {
            var from = _a2.from, to = _a2.to, l = _a2.l, r = _a2.r;
            addRange(target2, from, to);
            if (l)
              _addRangeSet(target2, l);
            if (r)
              _addRangeSet(target2, r);
          }
          if (!isEmptyRange(newSet))
            _addRangeSet(target, newSet);
        }
        function rangesOverlap2(rangeSet1, rangeSet2) {
          var i1 = getRangeSetIterator(rangeSet2);
          var nextResult1 = i1.next();
          if (nextResult1.done)
            return false;
          var a = nextResult1.value;
          var i2 = getRangeSetIterator(rangeSet1);
          var nextResult2 = i2.next(a.from);
          var b = nextResult2.value;
          while (!nextResult1.done && !nextResult2.done) {
            if (cmp2(b.from, a.to) <= 0 && cmp2(b.to, a.from) >= 0)
              return true;
            cmp2(a.from, b.from) < 0 ? a = (nextResult1 = i1.next(b.from)).value : b = (nextResult2 = i2.next(a.from)).value;
          }
          return false;
        }
        function getRangeSetIterator(node) {
          var state = isEmptyRange(node) ? null : { s: 0, n: node };
          return {
            next: function(key) {
              var keyProvided = arguments.length > 0;
              while (state) {
                switch (state.s) {
                  case 0:
                    state.s = 1;
                    if (keyProvided) {
                      while (state.n.l && cmp2(key, state.n.from) < 0)
                        state = { up: state, n: state.n.l, s: 1 };
                    } else {
                      while (state.n.l)
                        state = { up: state, n: state.n.l, s: 1 };
                    }
                  case 1:
                    state.s = 2;
                    if (!keyProvided || cmp2(key, state.n.to) <= 0)
                      return { value: state.n, done: false };
                  case 2:
                    if (state.n.r) {
                      state.s = 3;
                      state = { up: state, n: state.n.r, s: 0 };
                      continue;
                    }
                  case 3:
                    state = state.up;
                }
              }
              return { done: true };
            }
          };
        }
        function rebalance(target) {
          var _a2, _b;
          var diff = (((_a2 = target.r) === null || _a2 === void 0 ? void 0 : _a2.d) || 0) - (((_b = target.l) === null || _b === void 0 ? void 0 : _b.d) || 0);
          var r = diff > 1 ? "r" : diff < -1 ? "l" : "";
          if (r) {
            var l = r === "r" ? "l" : "r";
            var rootClone = __assign({}, target);
            var oldRootRight = target[r];
            target.from = oldRootRight.from;
            target.to = oldRootRight.to;
            target[r] = oldRootRight[r];
            rootClone[r] = oldRootRight[l];
            target[l] = rootClone;
            rootClone.d = computeDepth(rootClone);
          }
          target.d = computeDepth(target);
        }
        function computeDepth(_a2) {
          var r = _a2.r, l = _a2.l;
          return (r ? l ? Math.max(r.d, l.d) : r.d : l ? l.d : 0) + 1;
        }
        function extendObservabilitySet(target, newSet) {
          keys(newSet).forEach(function(part) {
            if (target[part])
              mergeRanges2(target[part], newSet[part]);
            else
              target[part] = cloneSimpleObjectTree(newSet[part]);
          });
          return target;
        }
        function obsSetsOverlap(os1, os2) {
          return os1.all || os2.all || Object.keys(os1).some(function(key) {
            return os2[key] && rangesOverlap2(os2[key], os1[key]);
          });
        }
        var cache = {};
        var unsignaledParts = {};
        var isTaskEnqueued = false;
        function signalSubscribersLazily(part, optimistic) {
          extendObservabilitySet(unsignaledParts, part);
          if (!isTaskEnqueued) {
            isTaskEnqueued = true;
            setTimeout(function() {
              isTaskEnqueued = false;
              var parts = unsignaledParts;
              unsignaledParts = {};
              signalSubscribersNow(parts, false);
            }, 0);
          }
        }
        function signalSubscribersNow(updatedParts, deleteAffectedCacheEntries) {
          if (deleteAffectedCacheEntries === void 0) {
            deleteAffectedCacheEntries = false;
          }
          var queriesToSignal = /* @__PURE__ */ new Set();
          if (updatedParts.all) {
            for (var _i = 0, _a2 = Object.values(cache); _i < _a2.length; _i++) {
              var tblCache = _a2[_i];
              collectTableSubscribers(tblCache, updatedParts, queriesToSignal, deleteAffectedCacheEntries);
            }
          } else {
            for (var key in updatedParts) {
              var parts = /^idb\:\/\/(.*)\/(.*)\//.exec(key);
              if (parts) {
                var dbName = parts[1], tableName = parts[2];
                var tblCache = cache["idb://".concat(dbName, "/").concat(tableName)];
                if (tblCache)
                  collectTableSubscribers(tblCache, updatedParts, queriesToSignal, deleteAffectedCacheEntries);
              }
            }
          }
          queriesToSignal.forEach(function(requery) {
            return requery();
          });
        }
        function collectTableSubscribers(tblCache, updatedParts, outQueriesToSignal, deleteAffectedCacheEntries) {
          var updatedEntryLists = [];
          for (var _i = 0, _a2 = Object.entries(tblCache.queries.query); _i < _a2.length; _i++) {
            var _b = _a2[_i], indexName = _b[0], entries = _b[1];
            var filteredEntries = [];
            for (var _c = 0, entries_1 = entries; _c < entries_1.length; _c++) {
              var entry = entries_1[_c];
              if (obsSetsOverlap(updatedParts, entry.obsSet)) {
                entry.subscribers.forEach(function(requery) {
                  return outQueriesToSignal.add(requery);
                });
              } else if (deleteAffectedCacheEntries) {
                filteredEntries.push(entry);
              }
            }
            if (deleteAffectedCacheEntries)
              updatedEntryLists.push([indexName, filteredEntries]);
          }
          if (deleteAffectedCacheEntries) {
            for (var _d = 0, updatedEntryLists_1 = updatedEntryLists; _d < updatedEntryLists_1.length; _d++) {
              var _e = updatedEntryLists_1[_d], indexName = _e[0], filteredEntries = _e[1];
              tblCache.queries.query[indexName] = filteredEntries;
            }
          }
        }
        function dexieOpen(db) {
          var state = db._state;
          var indexedDB2 = db._deps.indexedDB;
          if (state.isBeingOpened || db.idbdb)
            return state.dbReadyPromise.then(function() {
              return state.dbOpenError ? rejection(state.dbOpenError) : db;
            });
          state.isBeingOpened = true;
          state.dbOpenError = null;
          state.openComplete = false;
          var openCanceller = state.openCanceller;
          var nativeVerToOpen = Math.round(db.verno * 10);
          var schemaPatchMode = false;
          function throwIfCancelled() {
            if (state.openCanceller !== openCanceller)
              throw new exceptions.DatabaseClosed("db.open() was cancelled");
          }
          var resolveDbReady = state.dbReadyResolve, upgradeTransaction = null, wasCreated = false;
          var tryOpenDB = function() {
            return new DexiePromise(function(resolve, reject) {
              throwIfCancelled();
              if (!indexedDB2)
                throw new exceptions.MissingAPI();
              var dbName = db.name;
              var req = state.autoSchema || !nativeVerToOpen ? indexedDB2.open(dbName) : indexedDB2.open(dbName, nativeVerToOpen);
              if (!req)
                throw new exceptions.MissingAPI();
              req.onerror = eventRejectHandler(reject);
              req.onblocked = wrap(db._fireOnBlocked);
              req.onupgradeneeded = wrap(function(e) {
                upgradeTransaction = req.transaction;
                if (state.autoSchema && !db._options.allowEmptyDB) {
                  req.onerror = preventDefault;
                  upgradeTransaction.abort();
                  req.result.close();
                  var delreq = indexedDB2.deleteDatabase(dbName);
                  delreq.onsuccess = delreq.onerror = wrap(function() {
                    reject(new exceptions.NoSuchDatabase("Database ".concat(dbName, " doesnt exist")));
                  });
                } else {
                  upgradeTransaction.onerror = eventRejectHandler(reject);
                  var oldVer = e.oldVersion > Math.pow(2, 62) ? 0 : e.oldVersion;
                  wasCreated = oldVer < 1;
                  db.idbdb = req.result;
                  if (schemaPatchMode) {
                    patchCurrentVersion(db, upgradeTransaction);
                  }
                  runUpgraders(db, oldVer / 10, upgradeTransaction, reject);
                }
              }, reject);
              req.onsuccess = wrap(function() {
                upgradeTransaction = null;
                var idbdb = db.idbdb = req.result;
                var objectStoreNames = slice(idbdb.objectStoreNames);
                if (objectStoreNames.length > 0)
                  try {
                    var tmpTrans = idbdb.transaction(safariMultiStoreFix(objectStoreNames), "readonly");
                    if (state.autoSchema)
                      readGlobalSchema(db, idbdb, tmpTrans);
                    else {
                      adjustToExistingIndexNames(db, db._dbSchema, tmpTrans);
                      if (!verifyInstalledSchema(db, tmpTrans) && !schemaPatchMode) {
                        console.warn("Dexie SchemaDiff: Schema was extended without increasing the number passed to db.version(). Dexie will add missing parts and increment native version number to workaround this.");
                        idbdb.close();
                        nativeVerToOpen = idbdb.version + 1;
                        schemaPatchMode = true;
                        return resolve(tryOpenDB());
                      }
                    }
                    generateMiddlewareStacks(db, tmpTrans);
                  } catch (e) {
                  }
                connections.add(db);
                idbdb.onversionchange = wrap(function(ev) {
                  state.vcFired = true;
                  db.on("versionchange").fire(ev);
                });
                idbdb.onclose = wrap(function() {
                  db.close({ disableAutoOpen: false });
                });
                if (wasCreated)
                  _onDatabaseCreated(db._deps, dbName);
                resolve();
              }, reject);
            }).catch(function(err) {
              switch (err === null || err === void 0 ? void 0 : err.name) {
                case "UnknownError":
                  if (state.PR1398_maxLoop > 0) {
                    state.PR1398_maxLoop--;
                    console.warn("Dexie: Workaround for Chrome UnknownError on open()");
                    return tryOpenDB();
                  }
                  break;
                case "VersionError":
                  if (nativeVerToOpen > 0) {
                    nativeVerToOpen = 0;
                    return tryOpenDB();
                  }
                  break;
              }
              return DexiePromise.reject(err);
            });
          };
          return DexiePromise.race([
            openCanceller,
            (typeof navigator === "undefined" ? DexiePromise.resolve() : idbReady()).then(tryOpenDB)
          ]).then(function() {
            throwIfCancelled();
            state.onReadyBeingFired = [];
            return DexiePromise.resolve(vip(function() {
              return db.on.ready.fire(db.vip);
            })).then(function fireRemainders() {
              if (state.onReadyBeingFired.length > 0) {
                var remainders_1 = state.onReadyBeingFired.reduce(promisableChain, nop);
                state.onReadyBeingFired = [];
                return DexiePromise.resolve(vip(function() {
                  return remainders_1(db.vip);
                })).then(fireRemainders);
              }
            });
          }).finally(function() {
            if (state.openCanceller === openCanceller) {
              state.onReadyBeingFired = null;
              state.isBeingOpened = false;
            }
          }).catch(function(err) {
            state.dbOpenError = err;
            try {
              upgradeTransaction && upgradeTransaction.abort();
            } catch (_a2) {
            }
            if (openCanceller === state.openCanceller) {
              db._close();
            }
            return rejection(err);
          }).finally(function() {
            state.openComplete = true;
            resolveDbReady();
          }).then(function() {
            if (wasCreated) {
              var everything_1 = {};
              db.tables.forEach(function(table) {
                table.schema.indexes.forEach(function(idx) {
                  if (idx.name)
                    everything_1["idb://".concat(db.name, "/").concat(table.name, "/").concat(idx.name)] = new RangeSet2(-Infinity, [[[]]]);
                });
                everything_1["idb://".concat(db.name, "/").concat(table.name, "/")] = everything_1["idb://".concat(db.name, "/").concat(table.name, "/:dels")] = new RangeSet2(-Infinity, [[[]]]);
              });
              globalEvents(DEXIE_STORAGE_MUTATED_EVENT_NAME).fire(everything_1);
              signalSubscribersNow(everything_1, true);
            }
            return db;
          });
        }
        function awaitIterator(iterator) {
          var callNext = function(result) {
            return iterator.next(result);
          }, doThrow = function(error) {
            return iterator.throw(error);
          }, onSuccess = step(callNext), onError = step(doThrow);
          function step(getNext) {
            return function(val) {
              var next = getNext(val), value = next.value;
              return next.done ? value : !value || typeof value.then !== "function" ? isArray(value) ? Promise.all(value).then(onSuccess, onError) : onSuccess(value) : value.then(onSuccess, onError);
            };
          }
          return step(callNext)();
        }
        function extractTransactionArgs(mode, _tableArgs_, scopeFunc) {
          var i = arguments.length;
          if (i < 2)
            throw new exceptions.InvalidArgument("Too few arguments");
          var args = new Array(i - 1);
          while (--i)
            args[i - 1] = arguments[i];
          scopeFunc = args.pop();
          var tables = flatten(args);
          return [mode, tables, scopeFunc];
        }
        function enterTransactionScope(db, mode, storeNames, parentTransaction, scopeFunc) {
          return DexiePromise.resolve().then(function() {
            var transless = PSD.transless || PSD;
            var trans = db._createTransaction(mode, storeNames, db._dbSchema, parentTransaction);
            trans.explicit = true;
            var zoneProps = {
              trans,
              transless
            };
            if (parentTransaction) {
              trans.idbtrans = parentTransaction.idbtrans;
            } else {
              try {
                trans.create();
                trans.idbtrans._explicit = true;
                db._state.PR1398_maxLoop = 3;
              } catch (ex) {
                if (ex.name === errnames.InvalidState && db.isOpen() && --db._state.PR1398_maxLoop > 0) {
                  console.warn("Dexie: Need to reopen db");
                  db.close({ disableAutoOpen: false });
                  return db.open().then(function() {
                    return enterTransactionScope(db, mode, storeNames, null, scopeFunc);
                  });
                }
                return rejection(ex);
              }
            }
            var scopeFuncIsAsync = isAsyncFunction(scopeFunc);
            if (scopeFuncIsAsync) {
              incrementExpectedAwaits();
            }
            var returnValue;
            var promiseFollowed = DexiePromise.follow(function() {
              returnValue = scopeFunc.call(trans, trans);
              if (returnValue) {
                if (scopeFuncIsAsync) {
                  var decrementor = decrementExpectedAwaits.bind(null, null);
                  returnValue.then(decrementor, decrementor);
                } else if (typeof returnValue.next === "function" && typeof returnValue.throw === "function") {
                  returnValue = awaitIterator(returnValue);
                }
              }
            }, zoneProps);
            return (returnValue && typeof returnValue.then === "function" ? DexiePromise.resolve(returnValue).then(function(x) {
              return trans.active ? x : rejection(new exceptions.PrematureCommit("Transaction committed too early. See http://bit.ly/2kdckMn"));
            }) : promiseFollowed.then(function() {
              return returnValue;
            })).then(function(x) {
              if (parentTransaction)
                trans._resolve();
              return trans._completion.then(function() {
                return x;
              });
            }).catch(function(e) {
              trans._reject(e);
              return rejection(e);
            });
          });
        }
        function pad(a, value, count) {
          var result = isArray(a) ? a.slice() : [a];
          for (var i = 0; i < count; ++i)
            result.push(value);
          return result;
        }
        function createVirtualIndexMiddleware(down) {
          return __assign(__assign({}, down), { table: function(tableName) {
            var table = down.table(tableName);
            var schema = table.schema;
            var indexLookup = {};
            var allVirtualIndexes = [];
            function addVirtualIndexes(keyPath, keyTail, lowLevelIndex) {
              var keyPathAlias = getKeyPathAlias(keyPath);
              var indexList = indexLookup[keyPathAlias] = indexLookup[keyPathAlias] || [];
              var keyLength = keyPath == null ? 0 : typeof keyPath === "string" ? 1 : keyPath.length;
              var isVirtual = keyTail > 0;
              var virtualIndex = __assign(__assign({}, lowLevelIndex), { name: isVirtual ? "".concat(keyPathAlias, "(virtual-from:").concat(lowLevelIndex.name, ")") : lowLevelIndex.name, lowLevelIndex, isVirtual, keyTail, keyLength, extractKey: getKeyExtractor(keyPath), unique: !isVirtual && lowLevelIndex.unique });
              indexList.push(virtualIndex);
              if (!virtualIndex.isPrimaryKey) {
                allVirtualIndexes.push(virtualIndex);
              }
              if (keyLength > 1) {
                var virtualKeyPath = keyLength === 2 ? keyPath[0] : keyPath.slice(0, keyLength - 1);
                addVirtualIndexes(virtualKeyPath, keyTail + 1, lowLevelIndex);
              }
              indexList.sort(function(a, b) {
                return a.keyTail - b.keyTail;
              });
              return virtualIndex;
            }
            var primaryKey = addVirtualIndexes(schema.primaryKey.keyPath, 0, schema.primaryKey);
            indexLookup[":id"] = [primaryKey];
            for (var _i = 0, _a2 = schema.indexes; _i < _a2.length; _i++) {
              var index = _a2[_i];
              addVirtualIndexes(index.keyPath, 0, index);
            }
            function findBestIndex(keyPath) {
              var result2 = indexLookup[getKeyPathAlias(keyPath)];
              return result2 && result2[0];
            }
            function translateRange(range, keyTail) {
              return {
                type: range.type === 1 ? 2 : range.type,
                lower: pad(range.lower, range.lowerOpen ? down.MAX_KEY : down.MIN_KEY, keyTail),
                lowerOpen: true,
                upper: pad(range.upper, range.upperOpen ? down.MIN_KEY : down.MAX_KEY, keyTail),
                upperOpen: true
              };
            }
            function translateRequest(req) {
              var index2 = req.query.index;
              return index2.isVirtual ? __assign(__assign({}, req), { query: {
                index: index2.lowLevelIndex,
                range: translateRange(req.query.range, index2.keyTail)
              } }) : req;
            }
            var result = __assign(__assign({}, table), { schema: __assign(__assign({}, schema), { primaryKey, indexes: allVirtualIndexes, getIndexByKeyPath: findBestIndex }), count: function(req) {
              return table.count(translateRequest(req));
            }, query: function(req) {
              return table.query(translateRequest(req));
            }, openCursor: function(req) {
              var _a3 = req.query.index, keyTail = _a3.keyTail, isVirtual = _a3.isVirtual, keyLength = _a3.keyLength;
              if (!isVirtual)
                return table.openCursor(req);
              function createVirtualCursor(cursor) {
                function _continue(key) {
                  key != null ? cursor.continue(pad(key, req.reverse ? down.MAX_KEY : down.MIN_KEY, keyTail)) : req.unique ? cursor.continue(cursor.key.slice(0, keyLength).concat(req.reverse ? down.MIN_KEY : down.MAX_KEY, keyTail)) : cursor.continue();
                }
                var virtualCursor = Object.create(cursor, {
                  continue: { value: _continue },
                  continuePrimaryKey: {
                    value: function(key, primaryKey2) {
                      cursor.continuePrimaryKey(pad(key, down.MAX_KEY, keyTail), primaryKey2);
                    }
                  },
                  primaryKey: {
                    get: function() {
                      return cursor.primaryKey;
                    }
                  },
                  key: {
                    get: function() {
                      var key = cursor.key;
                      return keyLength === 1 ? key[0] : key.slice(0, keyLength);
                    }
                  },
                  value: {
                    get: function() {
                      return cursor.value;
                    }
                  }
                });
                return virtualCursor;
              }
              return table.openCursor(translateRequest(req)).then(function(cursor) {
                return cursor && createVirtualCursor(cursor);
              });
            } });
            return result;
          } });
        }
        var virtualIndexMiddleware = {
          stack: "dbcore",
          name: "VirtualIndexMiddleware",
          level: 1,
          create: createVirtualIndexMiddleware
        };
        function getObjectDiff(a, b, rv, prfx) {
          rv = rv || {};
          prfx = prfx || "";
          keys(a).forEach(function(prop) {
            if (!hasOwn(b, prop)) {
              rv[prfx + prop] = void 0;
            } else {
              var ap = a[prop], bp = b[prop];
              if (typeof ap === "object" && typeof bp === "object" && ap && bp) {
                var apTypeName = toStringTag(ap);
                var bpTypeName = toStringTag(bp);
                if (apTypeName !== bpTypeName) {
                  rv[prfx + prop] = b[prop];
                } else if (apTypeName === "Object") {
                  getObjectDiff(ap, bp, rv, prfx + prop + ".");
                } else if (ap !== bp) {
                  rv[prfx + prop] = b[prop];
                }
              } else if (ap !== bp)
                rv[prfx + prop] = b[prop];
            }
          });
          keys(b).forEach(function(prop) {
            if (!hasOwn(a, prop)) {
              rv[prfx + prop] = b[prop];
            }
          });
          return rv;
        }
        function getEffectiveKeys(primaryKey, req) {
          if (req.type === "delete")
            return req.keys;
          return req.keys || req.values.map(primaryKey.extractKey);
        }
        var hooksMiddleware = {
          stack: "dbcore",
          name: "HooksMiddleware",
          level: 2,
          create: function(downCore) {
            return __assign(__assign({}, downCore), { table: function(tableName) {
              var downTable = downCore.table(tableName);
              var primaryKey = downTable.schema.primaryKey;
              var tableMiddleware = __assign(__assign({}, downTable), { mutate: function(req) {
                var dxTrans = PSD.trans;
                var _a2 = dxTrans.table(tableName).hook, deleting = _a2.deleting, creating = _a2.creating, updating = _a2.updating;
                switch (req.type) {
                  case "add":
                    if (creating.fire === nop)
                      break;
                    return dxTrans._promise("readwrite", function() {
                      return addPutOrDelete(req);
                    }, true);
                  case "put":
                    if (creating.fire === nop && updating.fire === nop)
                      break;
                    return dxTrans._promise("readwrite", function() {
                      return addPutOrDelete(req);
                    }, true);
                  case "delete":
                    if (deleting.fire === nop)
                      break;
                    return dxTrans._promise("readwrite", function() {
                      return addPutOrDelete(req);
                    }, true);
                  case "deleteRange":
                    if (deleting.fire === nop)
                      break;
                    return dxTrans._promise("readwrite", function() {
                      return deleteRange(req);
                    }, true);
                }
                return downTable.mutate(req);
                function addPutOrDelete(req2) {
                  var dxTrans2 = PSD.trans;
                  var keys2 = req2.keys || getEffectiveKeys(primaryKey, req2);
                  if (!keys2)
                    throw new Error("Keys missing");
                  req2 = req2.type === "add" || req2.type === "put" ? __assign(__assign({}, req2), { keys: keys2 }) : __assign({}, req2);
                  if (req2.type !== "delete")
                    req2.values = __spreadArray([], req2.values, true);
                  if (req2.keys)
                    req2.keys = __spreadArray([], req2.keys, true);
                  return getExistingValues(downTable, req2, keys2).then(function(existingValues) {
                    var contexts = keys2.map(function(key, i) {
                      var existingValue = existingValues[i];
                      var ctx = { onerror: null, onsuccess: null };
                      if (req2.type === "delete") {
                        deleting.fire.call(ctx, key, existingValue, dxTrans2);
                      } else if (req2.type === "add" || existingValue === void 0) {
                        var generatedPrimaryKey = creating.fire.call(ctx, key, req2.values[i], dxTrans2);
                        if (key == null && generatedPrimaryKey != null) {
                          key = generatedPrimaryKey;
                          req2.keys[i] = key;
                          if (!primaryKey.outbound) {
                            setByKeyPath(req2.values[i], primaryKey.keyPath, key);
                          }
                        }
                      } else {
                        var objectDiff = getObjectDiff(existingValue, req2.values[i]);
                        var additionalChanges_1 = updating.fire.call(ctx, objectDiff, key, existingValue, dxTrans2);
                        if (additionalChanges_1) {
                          var requestedValue_1 = req2.values[i];
                          Object.keys(additionalChanges_1).forEach(function(keyPath) {
                            if (hasOwn(requestedValue_1, keyPath)) {
                              requestedValue_1[keyPath] = additionalChanges_1[keyPath];
                            } else {
                              setByKeyPath(requestedValue_1, keyPath, additionalChanges_1[keyPath]);
                            }
                          });
                        }
                      }
                      return ctx;
                    });
                    return downTable.mutate(req2).then(function(_a3) {
                      var failures = _a3.failures, results = _a3.results, numFailures = _a3.numFailures, lastResult = _a3.lastResult;
                      for (var i = 0; i < keys2.length; ++i) {
                        var primKey = results ? results[i] : keys2[i];
                        var ctx = contexts[i];
                        if (primKey == null) {
                          ctx.onerror && ctx.onerror(failures[i]);
                        } else {
                          ctx.onsuccess && ctx.onsuccess(
                            req2.type === "put" && existingValues[i] ? req2.values[i] : primKey
                          );
                        }
                      }
                      return { failures, results, numFailures, lastResult };
                    }).catch(function(error) {
                      contexts.forEach(function(ctx) {
                        return ctx.onerror && ctx.onerror(error);
                      });
                      return Promise.reject(error);
                    });
                  });
                }
                function deleteRange(req2) {
                  return deleteNextChunk(req2.trans, req2.range, 1e4);
                }
                function deleteNextChunk(trans, range, limit) {
                  return downTable.query({
                    trans,
                    values: false,
                    query: { index: primaryKey, range },
                    limit
                  }).then(function(_a3) {
                    var result = _a3.result;
                    return addPutOrDelete({
                      type: "delete",
                      keys: result,
                      trans
                    }).then(function(res) {
                      if (res.numFailures > 0)
                        return Promise.reject(res.failures[0]);
                      if (result.length < limit) {
                        return {
                          failures: [],
                          numFailures: 0,
                          lastResult: void 0
                        };
                      } else {
                        return deleteNextChunk(trans, __assign(__assign({}, range), { lower: result[result.length - 1], lowerOpen: true }), limit);
                      }
                    });
                  });
                }
              } });
              return tableMiddleware;
            } });
          }
        };
        function getExistingValues(table, req, effectiveKeys) {
          return req.type === "add" ? Promise.resolve([]) : table.getMany({
            trans: req.trans,
            keys: effectiveKeys,
            cache: "immutable"
          });
        }
        function getFromTransactionCache(keys2, cache2, clone) {
          try {
            if (!cache2)
              return null;
            if (cache2.keys.length < keys2.length)
              return null;
            var result = [];
            for (var i = 0, j = 0; i < cache2.keys.length && j < keys2.length; ++i) {
              if (cmp2(cache2.keys[i], keys2[j]) !== 0)
                continue;
              result.push(clone ? deepClone(cache2.values[i]) : cache2.values[i]);
              ++j;
            }
            return result.length === keys2.length ? result : null;
          } catch (_a2) {
            return null;
          }
        }
        var cacheExistingValuesMiddleware = {
          stack: "dbcore",
          level: -1,
          create: function(core) {
            return {
              table: function(tableName) {
                var table = core.table(tableName);
                return __assign(__assign({}, table), { getMany: function(req) {
                  if (!req.cache) {
                    return table.getMany(req);
                  }
                  var cachedResult = getFromTransactionCache(req.keys, req.trans["_cache"], req.cache === "clone");
                  if (cachedResult) {
                    return DexiePromise.resolve(cachedResult);
                  }
                  return table.getMany(req).then(function(res) {
                    req.trans["_cache"] = {
                      keys: req.keys,
                      values: req.cache === "clone" ? deepClone(res) : res
                    };
                    return res;
                  });
                }, mutate: function(req) {
                  if (req.type !== "add")
                    req.trans["_cache"] = null;
                  return table.mutate(req);
                } });
              }
            };
          }
        };
        function isCachableContext(ctx, table) {
          return ctx.trans.mode === "readonly" && !!ctx.subscr && !ctx.trans.explicit && ctx.trans.db._options.cache !== "disabled" && !table.schema.primaryKey.outbound;
        }
        function isCachableRequest(type2, req) {
          switch (type2) {
            case "query":
              return req.values && !req.unique;
            case "get":
              return false;
            case "getMany":
              return false;
            case "count":
              return false;
            case "openCursor":
              return false;
          }
        }
        var observabilityMiddleware = {
          stack: "dbcore",
          level: 0,
          name: "Observability",
          create: function(core) {
            var dbName = core.schema.name;
            var FULL_RANGE = new RangeSet2(core.MIN_KEY, core.MAX_KEY);
            return __assign(__assign({}, core), { transaction: function(stores, mode, options) {
              if (PSD.subscr && mode !== "readonly") {
                throw new exceptions.ReadOnly("Readwrite transaction in liveQuery context. Querier source: ".concat(PSD.querier));
              }
              return core.transaction(stores, mode, options);
            }, table: function(tableName) {
              var table = core.table(tableName);
              var schema = table.schema;
              var primaryKey = schema.primaryKey, indexes = schema.indexes;
              var extractKey = primaryKey.extractKey, outbound = primaryKey.outbound;
              var indexesWithAutoIncPK = primaryKey.autoIncrement && indexes.filter(function(index) {
                return index.compound && index.keyPath.includes(primaryKey.keyPath);
              });
              var tableClone = __assign(__assign({}, table), { mutate: function(req) {
                var _a2, _b;
                var trans = req.trans;
                var mutatedParts = req.mutatedParts || (req.mutatedParts = {});
                var getRangeSet = function(indexName) {
                  var part = "idb://".concat(dbName, "/").concat(tableName, "/").concat(indexName);
                  return mutatedParts[part] || (mutatedParts[part] = new RangeSet2());
                };
                var pkRangeSet = getRangeSet("");
                var delsRangeSet = getRangeSet(":dels");
                var type2 = req.type;
                var _c = req.type === "deleteRange" ? [req.range] : req.type === "delete" ? [req.keys] : req.values.length < 50 ? [
                  getEffectiveKeys(primaryKey, req).filter(function(id) {
                    return id;
                  }),
                  req.values
                ] : [], keys2 = _c[0], newObjs = _c[1];
                var oldCache = req.trans["_cache"];
                if (isArray(keys2)) {
                  pkRangeSet.addKeys(keys2);
                  var oldObjs = type2 === "delete" || keys2.length === newObjs.length ? getFromTransactionCache(keys2, oldCache) : null;
                  if (!oldObjs) {
                    delsRangeSet.addKeys(keys2);
                  }
                  if (oldObjs || newObjs) {
                    trackAffectedIndexes(getRangeSet, schema, oldObjs, newObjs);
                  }
                } else if (keys2) {
                  var range = {
                    from: (_a2 = keys2.lower) !== null && _a2 !== void 0 ? _a2 : core.MIN_KEY,
                    to: (_b = keys2.upper) !== null && _b !== void 0 ? _b : core.MAX_KEY
                  };
                  delsRangeSet.add(range);
                  pkRangeSet.add(range);
                } else {
                  pkRangeSet.add(FULL_RANGE);
                  delsRangeSet.add(FULL_RANGE);
                  schema.indexes.forEach(function(idx) {
                    return getRangeSet(idx.name).add(FULL_RANGE);
                  });
                }
                return table.mutate(req).then(function(res) {
                  if (keys2 && (req.type === "add" || req.type === "put")) {
                    pkRangeSet.addKeys(res.results);
                    if (indexesWithAutoIncPK) {
                      indexesWithAutoIncPK.forEach(function(idx) {
                        var idxVals = req.values.map(function(v) {
                          return idx.extractKey(v);
                        });
                        var pkPos = idx.keyPath.findIndex(function(prop) {
                          return prop === primaryKey.keyPath;
                        });
                        for (var i = 0, len = res.results.length; i < len; ++i) {
                          idxVals[i][pkPos] = res.results[i];
                        }
                        getRangeSet(idx.name).addKeys(idxVals);
                      });
                    }
                  }
                  trans.mutatedParts = extendObservabilitySet(trans.mutatedParts || {}, mutatedParts);
                  return res;
                });
              } });
              var getRange = function(_a2) {
                var _b, _c;
                var _d = _a2.query, index = _d.index, range = _d.range;
                return [
                  index,
                  new RangeSet2((_b = range.lower) !== null && _b !== void 0 ? _b : core.MIN_KEY, (_c = range.upper) !== null && _c !== void 0 ? _c : core.MAX_KEY)
                ];
              };
              var readSubscribers = {
                get: function(req) {
                  return [primaryKey, new RangeSet2(req.key)];
                },
                getMany: function(req) {
                  return [primaryKey, new RangeSet2().addKeys(req.keys)];
                },
                count: getRange,
                query: getRange,
                openCursor: getRange
              };
              keys(readSubscribers).forEach(function(method) {
                tableClone[method] = function(req) {
                  var subscr = PSD.subscr;
                  var isLiveQuery = !!subscr;
                  var cachable = isCachableContext(PSD, table) && isCachableRequest(method, req);
                  var obsSet = cachable ? req.obsSet = {} : subscr;
                  if (isLiveQuery) {
                    var getRangeSet = function(indexName) {
                      var part = "idb://".concat(dbName, "/").concat(tableName, "/").concat(indexName);
                      return obsSet[part] || (obsSet[part] = new RangeSet2());
                    };
                    var pkRangeSet_1 = getRangeSet("");
                    var delsRangeSet_1 = getRangeSet(":dels");
                    var _a2 = readSubscribers[method](req), queriedIndex = _a2[0], queriedRanges = _a2[1];
                    if (method === "query" && queriedIndex.isPrimaryKey && !req.values) {
                      delsRangeSet_1.add(queriedRanges);
                    } else {
                      getRangeSet(queriedIndex.name || "").add(queriedRanges);
                    }
                    if (!queriedIndex.isPrimaryKey) {
                      if (method === "count") {
                        delsRangeSet_1.add(FULL_RANGE);
                      } else {
                        var keysPromise_1 = method === "query" && outbound && req.values && table.query(__assign(__assign({}, req), { values: false }));
                        return table[method].apply(this, arguments).then(function(res) {
                          if (method === "query") {
                            if (outbound && req.values) {
                              return keysPromise_1.then(function(_a3) {
                                var resultingKeys = _a3.result;
                                pkRangeSet_1.addKeys(resultingKeys);
                                return res;
                              });
                            }
                            var pKeys = req.values ? res.result.map(extractKey) : res.result;
                            if (req.values) {
                              pkRangeSet_1.addKeys(pKeys);
                            } else {
                              delsRangeSet_1.addKeys(pKeys);
                            }
                          } else if (method === "openCursor") {
                            var cursor_1 = res;
                            var wantValues_1 = req.values;
                            return cursor_1 && Object.create(cursor_1, {
                              key: {
                                get: function() {
                                  delsRangeSet_1.addKey(cursor_1.primaryKey);
                                  return cursor_1.key;
                                }
                              },
                              primaryKey: {
                                get: function() {
                                  var pkey = cursor_1.primaryKey;
                                  delsRangeSet_1.addKey(pkey);
                                  return pkey;
                                }
                              },
                              value: {
                                get: function() {
                                  wantValues_1 && pkRangeSet_1.addKey(cursor_1.primaryKey);
                                  return cursor_1.value;
                                }
                              }
                            });
                          }
                          return res;
                        });
                      }
                    }
                  }
                  return table[method].apply(this, arguments);
                };
              });
              return tableClone;
            } });
          }
        };
        function trackAffectedIndexes(getRangeSet, schema, oldObjs, newObjs) {
          function addAffectedIndex(ix) {
            var rangeSet = getRangeSet(ix.name || "");
            function extractKey(obj) {
              return obj != null ? ix.extractKey(obj) : null;
            }
            var addKeyOrKeys = function(key) {
              return ix.multiEntry && isArray(key) ? key.forEach(function(key2) {
                return rangeSet.addKey(key2);
              }) : rangeSet.addKey(key);
            };
            (oldObjs || newObjs).forEach(function(_, i) {
              var oldKey = oldObjs && extractKey(oldObjs[i]);
              var newKey = newObjs && extractKey(newObjs[i]);
              if (cmp2(oldKey, newKey) !== 0) {
                if (oldKey != null)
                  addKeyOrKeys(oldKey);
                if (newKey != null)
                  addKeyOrKeys(newKey);
              }
            });
          }
          schema.indexes.forEach(addAffectedIndex);
        }
        function adjustOptimisticFromFailures(tblCache, req, res) {
          if (res.numFailures === 0)
            return req;
          if (req.type === "deleteRange") {
            return null;
          }
          var numBulkOps = req.keys ? req.keys.length : "values" in req && req.values ? req.values.length : 1;
          if (res.numFailures === numBulkOps) {
            return null;
          }
          var clone = __assign({}, req);
          if (isArray(clone.keys)) {
            clone.keys = clone.keys.filter(function(_, i) {
              return !(i in res.failures);
            });
          }
          if ("values" in clone && isArray(clone.values)) {
            clone.values = clone.values.filter(function(_, i) {
              return !(i in res.failures);
            });
          }
          return clone;
        }
        function isAboveLower(key, range) {
          return range.lower === void 0 ? true : range.lowerOpen ? cmp2(key, range.lower) > 0 : cmp2(key, range.lower) >= 0;
        }
        function isBelowUpper(key, range) {
          return range.upper === void 0 ? true : range.upperOpen ? cmp2(key, range.upper) < 0 : cmp2(key, range.upper) <= 0;
        }
        function isWithinRange(key, range) {
          return isAboveLower(key, range) && isBelowUpper(key, range);
        }
        function applyOptimisticOps(result, req, ops, table, cacheEntry, immutable) {
          if (!ops || ops.length === 0)
            return result;
          var index = req.query.index;
          var multiEntry = index.multiEntry;
          var queryRange = req.query.range;
          var primaryKey = table.schema.primaryKey;
          var extractPrimKey = primaryKey.extractKey;
          var extractIndex = index.extractKey;
          var extractLowLevelIndex = (index.lowLevelIndex || index).extractKey;
          var finalResult = ops.reduce(function(result2, op) {
            var modifedResult = result2;
            var includedValues = [];
            if (op.type === "add" || op.type === "put") {
              var includedPKs = new RangeSet2();
              for (var i = op.values.length - 1; i >= 0; --i) {
                var value = op.values[i];
                var pk = extractPrimKey(value);
                if (includedPKs.hasKey(pk))
                  continue;
                var key = extractIndex(value);
                if (multiEntry && isArray(key) ? key.some(function(k) {
                  return isWithinRange(k, queryRange);
                }) : isWithinRange(key, queryRange)) {
                  includedPKs.addKey(pk);
                  includedValues.push(value);
                }
              }
            }
            switch (op.type) {
              case "add": {
                var existingKeys_1 = new RangeSet2().addKeys(req.values ? result2.map(function(v) {
                  return extractPrimKey(v);
                }) : result2);
                modifedResult = result2.concat(req.values ? includedValues.filter(function(v) {
                  var key2 = extractPrimKey(v);
                  if (existingKeys_1.hasKey(key2))
                    return false;
                  existingKeys_1.addKey(key2);
                  return true;
                }) : includedValues.map(function(v) {
                  return extractPrimKey(v);
                }).filter(function(k) {
                  if (existingKeys_1.hasKey(k))
                    return false;
                  existingKeys_1.addKey(k);
                  return true;
                }));
                break;
              }
              case "put": {
                var keySet_1 = new RangeSet2().addKeys(op.values.map(function(v) {
                  return extractPrimKey(v);
                }));
                modifedResult = result2.filter(
                  function(item) {
                    return !keySet_1.hasKey(req.values ? extractPrimKey(item) : item);
                  }
                ).concat(
                  req.values ? includedValues : includedValues.map(function(v) {
                    return extractPrimKey(v);
                  })
                );
                break;
              }
              case "delete":
                var keysToDelete_1 = new RangeSet2().addKeys(op.keys);
                modifedResult = result2.filter(function(item) {
                  return !keysToDelete_1.hasKey(req.values ? extractPrimKey(item) : item);
                });
                break;
              case "deleteRange":
                var range_1 = op.range;
                modifedResult = result2.filter(function(item) {
                  return !isWithinRange(extractPrimKey(item), range_1);
                });
                break;
            }
            return modifedResult;
          }, result);
          if (finalResult === result)
            return result;
          var sorter = function(a, b) {
            return cmp2(extractLowLevelIndex(a), extractLowLevelIndex(b)) || cmp2(extractPrimKey(a), extractPrimKey(b));
          };
          finalResult.sort(req.direction === "prev" || req.direction === "prevunique" ? function(a, b) {
            return sorter(b, a);
          } : sorter);
          if (req.limit && req.limit < Infinity) {
            if (finalResult.length > req.limit) {
              finalResult.length = req.limit;
            } else if (result.length === req.limit && finalResult.length < req.limit) {
              cacheEntry.dirty = true;
            }
          }
          return immutable ? Object.freeze(finalResult) : finalResult;
        }
        function areRangesEqual(r1, r2) {
          return cmp2(r1.lower, r2.lower) === 0 && cmp2(r1.upper, r2.upper) === 0 && !!r1.lowerOpen === !!r2.lowerOpen && !!r1.upperOpen === !!r2.upperOpen;
        }
        function compareLowers(lower1, lower2, lowerOpen1, lowerOpen2) {
          if (lower1 === void 0)
            return lower2 !== void 0 ? -1 : 0;
          if (lower2 === void 0)
            return 1;
          var c = cmp2(lower1, lower2);
          if (c === 0) {
            if (lowerOpen1 && lowerOpen2)
              return 0;
            if (lowerOpen1)
              return 1;
            if (lowerOpen2)
              return -1;
          }
          return c;
        }
        function compareUppers(upper1, upper2, upperOpen1, upperOpen2) {
          if (upper1 === void 0)
            return upper2 !== void 0 ? 1 : 0;
          if (upper2 === void 0)
            return -1;
          var c = cmp2(upper1, upper2);
          if (c === 0) {
            if (upperOpen1 && upperOpen2)
              return 0;
            if (upperOpen1)
              return -1;
            if (upperOpen2)
              return 1;
          }
          return c;
        }
        function isSuperRange(r1, r2) {
          return compareLowers(r1.lower, r2.lower, r1.lowerOpen, r2.lowerOpen) <= 0 && compareUppers(r1.upper, r2.upper, r1.upperOpen, r2.upperOpen) >= 0;
        }
        function findCompatibleQuery(dbName, tableName, type2, req) {
          var _a2;
          var tblCache = cache["idb://".concat(dbName, "/").concat(tableName)];
          if (!tblCache)
            return [];
          var queries = tblCache.queries[type2];
          if (!queries)
            return [null, false, tblCache, null];
          var indexName = req.query ? req.query.index.name : null;
          var entries = queries[indexName || ""];
          if (!entries)
            return [null, false, tblCache, null];
          switch (type2) {
            case "query":
              var reqDirection_1 = (_a2 = req.direction) !== null && _a2 !== void 0 ? _a2 : "next";
              var equalEntry = entries.find(function(entry) {
                var _a3;
                return entry.req.limit === req.limit && entry.req.values === req.values && ((_a3 = entry.req.direction) !== null && _a3 !== void 0 ? _a3 : "next") === reqDirection_1 && areRangesEqual(entry.req.query.range, req.query.range);
              });
              if (equalEntry)
                return [
                  equalEntry,
                  true,
                  tblCache,
                  entries
                ];
              var superEntry = entries.find(function(entry) {
                var _a3;
                var limit = "limit" in entry.req ? entry.req.limit : Infinity;
                return limit >= req.limit && ((_a3 = entry.req.direction) !== null && _a3 !== void 0 ? _a3 : "next") === reqDirection_1 && (req.values ? entry.req.values : true) && isSuperRange(entry.req.query.range, req.query.range);
              });
              return [superEntry, false, tblCache, entries];
            case "count":
              var countQuery = entries.find(function(entry) {
                return areRangesEqual(entry.req.query.range, req.query.range);
              });
              return [countQuery, !!countQuery, tblCache, entries];
          }
        }
        function subscribeToCacheEntry(cacheEntry, container, requery, signal) {
          cacheEntry.subscribers.add(requery);
          signal.addEventListener("abort", function() {
            cacheEntry.subscribers.delete(requery);
            if (cacheEntry.subscribers.size === 0) {
              enqueForDeletion(cacheEntry, container);
            }
          });
        }
        function enqueForDeletion(cacheEntry, container) {
          setTimeout(function() {
            if (cacheEntry.subscribers.size === 0) {
              delArrayItem(container, cacheEntry);
            }
          }, 3e3);
        }
        var cacheMiddleware = {
          stack: "dbcore",
          level: 0,
          name: "Cache",
          create: function(core) {
            var dbName = core.schema.name;
            var coreMW = __assign(__assign({}, core), { transaction: function(stores, mode, options) {
              var idbtrans = core.transaction(stores, mode, options);
              if (mode === "readwrite") {
                var ac_1 = new AbortController();
                var signal = ac_1.signal;
                var endTransaction = function(wasCommitted) {
                  return function() {
                    ac_1.abort();
                    if (mode === "readwrite") {
                      var affectedSubscribers_1 = /* @__PURE__ */ new Set();
                      for (var _i = 0, stores_1 = stores; _i < stores_1.length; _i++) {
                        var storeName = stores_1[_i];
                        var tblCache = cache["idb://".concat(dbName, "/").concat(storeName)];
                        if (tblCache) {
                          var table = core.table(storeName);
                          var ops = tblCache.optimisticOps.filter(function(op) {
                            return op.trans === idbtrans;
                          });
                          if (idbtrans._explicit && wasCommitted && idbtrans.mutatedParts) {
                            for (var _a2 = 0, _b = Object.values(tblCache.queries.query); _a2 < _b.length; _a2++) {
                              var entries = _b[_a2];
                              for (var _c = 0, _d = entries.slice(); _c < _d.length; _c++) {
                                var entry = _d[_c];
                                if (obsSetsOverlap(entry.obsSet, idbtrans.mutatedParts)) {
                                  delArrayItem(entries, entry);
                                  entry.subscribers.forEach(function(requery) {
                                    return affectedSubscribers_1.add(requery);
                                  });
                                }
                              }
                            }
                          } else if (ops.length > 0) {
                            tblCache.optimisticOps = tblCache.optimisticOps.filter(function(op) {
                              return op.trans !== idbtrans;
                            });
                            for (var _e = 0, _f = Object.values(tblCache.queries.query); _e < _f.length; _e++) {
                              var entries = _f[_e];
                              for (var _g = 0, _h = entries.slice(); _g < _h.length; _g++) {
                                var entry = _h[_g];
                                if (entry.res != null && idbtrans.mutatedParts) {
                                  if (wasCommitted && !entry.dirty) {
                                    var freezeResults = Object.isFrozen(entry.res);
                                    var modRes = applyOptimisticOps(entry.res, entry.req, ops, table, entry, freezeResults);
                                    if (entry.dirty) {
                                      delArrayItem(entries, entry);
                                      entry.subscribers.forEach(function(requery) {
                                        return affectedSubscribers_1.add(requery);
                                      });
                                    } else if (modRes !== entry.res) {
                                      entry.res = modRes;
                                      entry.promise = DexiePromise.resolve({
                                        result: modRes
                                      });
                                    }
                                  } else {
                                    if (entry.dirty) {
                                      delArrayItem(entries, entry);
                                    }
                                    entry.subscribers.forEach(function(requery) {
                                      return affectedSubscribers_1.add(requery);
                                    });
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                      affectedSubscribers_1.forEach(function(requery) {
                        return requery();
                      });
                    }
                  };
                };
                idbtrans.addEventListener("abort", endTransaction(false), {
                  signal
                });
                idbtrans.addEventListener("error", endTransaction(false), {
                  signal
                });
                idbtrans.addEventListener("complete", endTransaction(true), {
                  signal
                });
              }
              return idbtrans;
            }, table: function(tableName) {
              var downTable = core.table(tableName);
              var primKey = downTable.schema.primaryKey;
              var tableMW = __assign(__assign({}, downTable), { mutate: function(req) {
                var trans = PSD.trans;
                if (primKey.outbound || trans.db._options.cache === "disabled" || trans.explicit || trans.idbtrans.mode !== "readwrite") {
                  return downTable.mutate(req);
                }
                var tblCache = cache["idb://".concat(dbName, "/").concat(tableName)];
                if (!tblCache)
                  return downTable.mutate(req);
                var promise = downTable.mutate(req);
                if ((req.type === "add" || req.type === "put") && (req.values.length >= 50 || getEffectiveKeys(primKey, req).some(function(key) {
                  return key == null;
                }))) {
                  promise.then(function(res) {
                    var reqWithResolvedKeys = __assign(__assign({}, req), { values: req.values.map(function(value, i) {
                      var _a2;
                      if (res.failures[i])
                        return value;
                      var valueWithKey = ((_a2 = primKey.keyPath) === null || _a2 === void 0 ? void 0 : _a2.includes(".")) ? deepClone(value) : __assign({}, value);
                      setByKeyPath(valueWithKey, primKey.keyPath, res.results[i]);
                      return valueWithKey;
                    }) });
                    var adjustedReq = adjustOptimisticFromFailures(tblCache, reqWithResolvedKeys, res);
                    tblCache.optimisticOps.push(adjustedReq);
                    queueMicrotask(function() {
                      return req.mutatedParts && signalSubscribersLazily(req.mutatedParts);
                    });
                  });
                } else {
                  tblCache.optimisticOps.push(req);
                  req.mutatedParts && signalSubscribersLazily(req.mutatedParts);
                  promise.then(function(res) {
                    if (res.numFailures > 0) {
                      delArrayItem(tblCache.optimisticOps, req);
                      var adjustedReq = adjustOptimisticFromFailures(tblCache, req, res);
                      if (adjustedReq) {
                        tblCache.optimisticOps.push(adjustedReq);
                      }
                      req.mutatedParts && signalSubscribersLazily(req.mutatedParts);
                    }
                  });
                  promise.catch(function() {
                    delArrayItem(tblCache.optimisticOps, req);
                    req.mutatedParts && signalSubscribersLazily(req.mutatedParts);
                  });
                }
                return promise;
              }, query: function(req) {
                var _a2;
                if (!isCachableContext(PSD, downTable) || !isCachableRequest("query", req))
                  return downTable.query(req);
                var freezeResults = ((_a2 = PSD.trans) === null || _a2 === void 0 ? void 0 : _a2.db._options.cache) === "immutable";
                var _b = PSD, requery = _b.requery, signal = _b.signal;
                var _c = findCompatibleQuery(dbName, tableName, "query", req), cacheEntry = _c[0], exactMatch = _c[1], tblCache = _c[2], container = _c[3];
                if (cacheEntry && exactMatch) {
                  cacheEntry.obsSet = req.obsSet;
                } else {
                  var promise = downTable.query(req).then(function(res) {
                    var result = res.result;
                    if (cacheEntry)
                      cacheEntry.res = result;
                    if (freezeResults) {
                      for (var i = 0, l = result.length; i < l; ++i) {
                        Object.freeze(result[i]);
                      }
                      Object.freeze(result);
                    }
                    return res;
                  }).catch(function(error) {
                    if (container && cacheEntry)
                      delArrayItem(container, cacheEntry);
                    return Promise.reject(error);
                  });
                  cacheEntry = {
                    obsSet: req.obsSet,
                    promise,
                    subscribers: /* @__PURE__ */ new Set(),
                    type: "query",
                    req,
                    dirty: false
                  };
                  if (container) {
                    container.push(cacheEntry);
                  } else {
                    container = [cacheEntry];
                    if (!tblCache) {
                      tblCache = cache["idb://".concat(dbName, "/").concat(tableName)] = {
                        queries: {
                          query: {},
                          count: {}
                        },
                        objs: /* @__PURE__ */ new Map(),
                        optimisticOps: [],
                        unsignaledParts: {}
                      };
                    }
                    tblCache.queries.query[req.query.index.name || ""] = container;
                  }
                }
                subscribeToCacheEntry(cacheEntry, container, requery, signal);
                return cacheEntry.promise.then(function(res) {
                  var result = applyOptimisticOps(res.result, req, tblCache === null || tblCache === void 0 ? void 0 : tblCache.optimisticOps, downTable, cacheEntry, freezeResults);
                  return {
                    result: freezeResults ? result : deepClone(result)
                  };
                });
              } });
              return tableMW;
            } });
            return coreMW;
          }
        };
        function vipify(target, vipDb) {
          return new Proxy(target, {
            get: function(target2, prop, receiver) {
              if (prop === "db")
                return vipDb;
              return Reflect.get(target2, prop, receiver);
            }
          });
        }
        var Dexie$1 = (function() {
          function Dexie3(name, options) {
            var _this = this;
            this._middlewares = {};
            this.verno = 0;
            var deps = Dexie3.dependencies;
            this._options = options = __assign({
              addons: Dexie3.addons,
              autoOpen: true,
              indexedDB: deps.indexedDB,
              IDBKeyRange: deps.IDBKeyRange,
              cache: "cloned",
              maxConnections: DEFAULT_MAX_CONNECTIONS
            }, options);
            this._deps = {
              indexedDB: options.indexedDB,
              IDBKeyRange: options.IDBKeyRange
            };
            var addons = options.addons;
            this._dbSchema = {};
            this._versions = [];
            this._storeNames = [];
            this._allTables = {};
            this.idbdb = null;
            this._novip = this;
            var state = {
              dbOpenError: null,
              isBeingOpened: false,
              onReadyBeingFired: null,
              openComplete: false,
              dbReadyResolve: nop,
              dbReadyPromise: null,
              cancelOpen: nop,
              openCanceller: null,
              autoSchema: true,
              PR1398_maxLoop: 3,
              autoOpen: options.autoOpen
            };
            state.dbReadyPromise = new DexiePromise(function(resolve) {
              state.dbReadyResolve = resolve;
            });
            state.openCanceller = new DexiePromise(function(_, reject) {
              state.cancelOpen = reject;
            });
            this._state = state;
            this.name = name;
            this.on = Events(this, "populate", "blocked", "versionchange", "close", {
              ready: [promisableChain, nop]
            });
            this.once = function(event, callback) {
              var fn = function() {
                var args = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                  args[_i] = arguments[_i];
                }
                _this.on(event).unsubscribe(fn);
                callback.apply(_this, args);
              };
              return _this.on(event, fn);
            };
            this.on.ready.subscribe = override(this.on.ready.subscribe, function(subscribe) {
              return function(subscriber, bSticky) {
                Dexie3.vip(function() {
                  var state2 = _this._state;
                  if (state2.openComplete) {
                    if (!state2.dbOpenError)
                      DexiePromise.resolve().then(subscriber);
                    if (bSticky)
                      subscribe(subscriber);
                  } else if (state2.onReadyBeingFired) {
                    state2.onReadyBeingFired.push(subscriber);
                    if (bSticky)
                      subscribe(subscriber);
                  } else {
                    subscribe(subscriber);
                    var db_1 = _this;
                    if (!bSticky)
                      subscribe(function unsubscribe() {
                        db_1.on.ready.unsubscribe(subscriber);
                        db_1.on.ready.unsubscribe(unsubscribe);
                      });
                  }
                });
              };
            });
            this.Collection = createCollectionConstructor(this);
            this.Table = createTableConstructor(this);
            this.Transaction = createTransactionConstructor(this);
            this.Version = createVersionConstructor(this);
            this.WhereClause = createWhereClauseConstructor(this);
            this.on("versionchange", function(ev) {
              if (ev.newVersion > 0)
                console.warn("Another connection wants to upgrade database '".concat(_this.name, "'. Closing db now to resume the upgrade."));
              else
                console.warn("Another connection wants to delete database '".concat(_this.name, "'. Closing db now to resume the delete request."));
              _this.close({ disableAutoOpen: false });
            });
            this.on("blocked", function(ev) {
              if (!ev.newVersion || ev.newVersion < ev.oldVersion)
                console.warn("Dexie.delete('".concat(_this.name, "') was blocked"));
              else
                console.warn("Upgrade '".concat(_this.name, "' blocked by other connection holding version ").concat(ev.oldVersion / 10));
            });
            this._maxKey = getMaxKey(options.IDBKeyRange);
            this._createTransaction = function(mode, storeNames, dbschema, parentTransaction) {
              return new _this.Transaction(mode, storeNames, dbschema, _this._options.chromeTransactionDurability, parentTransaction);
            };
            this._fireOnBlocked = function(ev) {
              _this.on("blocked").fire(ev);
              connections.toArray().filter(function(c) {
                return c.name === _this.name && c !== _this && !c._state.vcFired;
              }).map(function(c) {
                return c.on("versionchange").fire(ev);
              });
            };
            this.use(cacheExistingValuesMiddleware);
            this.use(cacheMiddleware);
            this.use(observabilityMiddleware);
            this.use(virtualIndexMiddleware);
            this.use(hooksMiddleware);
            var vipDB = new Proxy(this, {
              get: function(_, prop, receiver) {
                if (prop === "_vip")
                  return true;
                if (prop === "table")
                  return function(tableName) {
                    return vipify(_this.table(tableName), vipDB);
                  };
                var rv = Reflect.get(_, prop, receiver);
                if (rv instanceof Table)
                  return vipify(rv, vipDB);
                if (prop === "tables")
                  return rv.map(function(t) {
                    return vipify(t, vipDB);
                  });
                if (prop === "_createTransaction")
                  return function() {
                    var tx = rv.apply(this, arguments);
                    return vipify(tx, vipDB);
                  };
                return rv;
              }
            });
            this.vip = vipDB;
            addons.forEach(function(addon) {
              return addon(_this);
            });
          }
          Dexie3.prototype.version = function(versionNumber) {
            if (isNaN(versionNumber) || versionNumber < 0.1)
              throw new exceptions.Type("Given version is not a positive number");
            versionNumber = Math.round(versionNumber * 10) / 10;
            if (this.idbdb || this._state.isBeingOpened)
              throw new exceptions.Schema("Cannot add version when database is open");
            this.verno = Math.max(this.verno, versionNumber);
            var versions = this._versions;
            var versionInstance = versions.filter(function(v) {
              return v._cfg.version === versionNumber;
            })[0];
            if (versionInstance)
              return versionInstance;
            versionInstance = new this.Version(versionNumber);
            versions.push(versionInstance);
            versions.sort(lowerVersionFirst);
            versionInstance.stores({});
            this._state.autoSchema = false;
            return versionInstance;
          };
          Dexie3.prototype._whenReady = function(fn) {
            var _this = this;
            return this.idbdb && (this._state.openComplete || PSD.letThrough || this._vip) ? fn() : new DexiePromise(function(resolve, reject) {
              if (_this._state.openComplete) {
                return reject(new exceptions.DatabaseClosed(_this._state.dbOpenError));
              }
              if (!_this._state.isBeingOpened) {
                if (!_this._state.autoOpen) {
                  reject(new exceptions.DatabaseClosed());
                  return;
                }
                _this.open().catch(nop);
              }
              _this._state.dbReadyPromise.then(resolve, reject);
            }).then(fn);
          };
          Dexie3.prototype.use = function(_a2) {
            var stack = _a2.stack, create = _a2.create, level = _a2.level, name = _a2.name;
            if (name)
              this.unuse({ stack, name });
            var middlewares = this._middlewares[stack] || (this._middlewares[stack] = []);
            middlewares.push({
              stack,
              create,
              level: level == null ? 10 : level,
              name
            });
            middlewares.sort(function(a, b) {
              return a.level - b.level;
            });
            return this;
          };
          Dexie3.prototype.unuse = function(_a2) {
            var stack = _a2.stack, name = _a2.name, create = _a2.create;
            if (stack && this._middlewares[stack]) {
              this._middlewares[stack] = this._middlewares[stack].filter(function(mw) {
                return create ? mw.create !== create : name ? mw.name !== name : false;
              });
            }
            return this;
          };
          Dexie3.prototype.open = function() {
            var _this = this;
            return usePSD(
              globalPSD,
              function() {
                return dexieOpen(_this);
              }
            );
          };
          Dexie3.prototype._close = function() {
            this.on.close.fire(new CustomEvent("close"));
            var state = this._state;
            connections.remove(this);
            if (this.idbdb) {
              try {
                this.idbdb.close();
              } catch (e) {
              }
              this.idbdb = null;
            }
            if (!state.isBeingOpened) {
              state.dbReadyPromise = new DexiePromise(function(resolve) {
                state.dbReadyResolve = resolve;
              });
              state.openCanceller = new DexiePromise(function(_, reject) {
                state.cancelOpen = reject;
              });
            }
          };
          Dexie3.prototype.close = function(_a2) {
            var _b = _a2 === void 0 ? { disableAutoOpen: true } : _a2, disableAutoOpen = _b.disableAutoOpen;
            var state = this._state;
            if (disableAutoOpen) {
              if (state.isBeingOpened) {
                state.cancelOpen(new exceptions.DatabaseClosed());
              }
              this._close();
              state.autoOpen = false;
              state.dbOpenError = new exceptions.DatabaseClosed();
            } else {
              this._close();
              state.autoOpen = this._options.autoOpen || state.isBeingOpened;
              state.openComplete = false;
              state.dbOpenError = null;
            }
          };
          Dexie3.prototype.delete = function(closeOptions) {
            var _this = this;
            if (closeOptions === void 0) {
              closeOptions = { disableAutoOpen: true };
            }
            var hasInvalidArguments = arguments.length > 0 && typeof arguments[0] !== "object";
            var state = this._state;
            return new DexiePromise(function(resolve, reject) {
              var doDelete = function() {
                _this.close(closeOptions);
                var req = _this._deps.indexedDB.deleteDatabase(_this.name);
                req.onsuccess = wrap(function() {
                  _onDatabaseDeleted(_this._deps, _this.name);
                  resolve();
                });
                req.onerror = eventRejectHandler(reject);
                req.onblocked = _this._fireOnBlocked;
              };
              if (hasInvalidArguments)
                throw new exceptions.InvalidArgument("Invalid closeOptions argument to db.delete()");
              if (state.isBeingOpened) {
                state.dbReadyPromise.then(doDelete);
              } else {
                doDelete();
              }
            });
          };
          Dexie3.prototype.backendDB = function() {
            return this.idbdb;
          };
          Dexie3.prototype.isOpen = function() {
            return this.idbdb !== null;
          };
          Dexie3.prototype.hasBeenClosed = function() {
            var dbOpenError = this._state.dbOpenError;
            return dbOpenError && dbOpenError.name === "DatabaseClosed";
          };
          Dexie3.prototype.hasFailed = function() {
            return this._state.dbOpenError !== null;
          };
          Dexie3.prototype.dynamicallyOpened = function() {
            return this._state.autoSchema;
          };
          Object.defineProperty(Dexie3.prototype, "tables", {
            get: function() {
              var _this = this;
              return keys(this._allTables).map(function(name) {
                return _this._allTables[name];
              });
            },
            enumerable: false,
            configurable: true
          });
          Dexie3.prototype.transaction = function() {
            var args = extractTransactionArgs.apply(this, arguments);
            return this._transaction.apply(this, args);
          };
          Dexie3.prototype._transaction = function(mode, tables, scopeFunc) {
            var _this = this;
            var parentTransaction = PSD.trans;
            if (!parentTransaction || parentTransaction.db !== this || mode.indexOf("!") !== -1)
              parentTransaction = null;
            var onlyIfCompatible = mode.indexOf("?") !== -1;
            mode = mode.replace("!", "").replace("?", "");
            var idbMode, storeNames;
            try {
              storeNames = tables.map(function(table) {
                var storeName = table instanceof _this.Table ? table.name : table;
                if (typeof storeName !== "string")
                  throw new TypeError("Invalid table argument to Dexie.transaction(). Only Table or String are allowed");
                return storeName;
              });
              if (mode == "r" || mode === READONLY)
                idbMode = READONLY;
              else if (mode == "rw" || mode == READWRITE)
                idbMode = READWRITE;
              else
                throw new exceptions.InvalidArgument("Invalid transaction mode: " + mode);
              if (parentTransaction) {
                if (parentTransaction.mode === READONLY && idbMode === READWRITE) {
                  if (onlyIfCompatible) {
                    parentTransaction = null;
                  } else
                    throw new exceptions.SubTransaction("Cannot enter a sub-transaction with READWRITE mode when parent transaction is READONLY");
                }
                if (parentTransaction) {
                  storeNames.forEach(function(storeName) {
                    if (parentTransaction && parentTransaction.storeNames.indexOf(storeName) === -1) {
                      if (onlyIfCompatible) {
                        parentTransaction = null;
                      } else
                        throw new exceptions.SubTransaction("Table " + storeName + " not included in parent transaction.");
                    }
                  });
                }
                if (onlyIfCompatible && parentTransaction && !parentTransaction.active) {
                  parentTransaction = null;
                }
              }
            } catch (e) {
              return parentTransaction ? parentTransaction._promise(null, function(_, reject) {
                reject(e);
              }) : rejection(e);
            }
            var enterTransaction = enterTransactionScope.bind(null, this, idbMode, storeNames, parentTransaction, scopeFunc);
            return parentTransaction ? parentTransaction._promise(idbMode, enterTransaction, "lock") : PSD.trans ? usePSD(PSD.transless, function() {
              return _this._whenReady(enterTransaction);
            }) : this._whenReady(enterTransaction);
          };
          Dexie3.prototype.table = function(tableName) {
            if (!hasOwn(this._allTables, tableName)) {
              throw new exceptions.InvalidTable("Table ".concat(tableName, " does not exist"));
            }
            return this._allTables[tableName];
          };
          return Dexie3;
        })();
        var symbolObservable = typeof Symbol !== "undefined" && "observable" in Symbol ? Symbol.observable : "@@observable";
        var Observable = (function() {
          function Observable2(subscribe) {
            this._subscribe = subscribe;
          }
          Observable2.prototype.subscribe = function(x, error, complete) {
            return this._subscribe(!x || typeof x === "function" ? { next: x, error, complete } : x);
          };
          Observable2.prototype[symbolObservable] = function() {
            return this;
          };
          return Observable2;
        })();
        var domDeps;
        try {
          domDeps = {
            indexedDB: _global.indexedDB || _global.mozIndexedDB || _global.webkitIndexedDB || _global.msIndexedDB,
            IDBKeyRange: _global.IDBKeyRange || _global.webkitIDBKeyRange
          };
        } catch (e) {
          domDeps = { indexedDB: null, IDBKeyRange: null };
        }
        function liveQuery2(querier) {
          var hasValue = false;
          var currentValue;
          var observable = new Observable(function(observer) {
            var scopeFuncIsAsync = isAsyncFunction(querier);
            function execute(ctx) {
              var wasRootExec = beginMicroTickScope();
              try {
                if (scopeFuncIsAsync) {
                  incrementExpectedAwaits();
                }
                var rv = newScope(querier, ctx);
                if (scopeFuncIsAsync) {
                  rv = rv.finally(decrementExpectedAwaits);
                }
                return rv;
              } finally {
                wasRootExec && endMicroTickScope();
              }
            }
            var closed = false;
            var abortController;
            var accumMuts = {};
            var currentObs = {};
            var subscription = {
              get closed() {
                return closed;
              },
              unsubscribe: function() {
                if (closed)
                  return;
                closed = true;
                if (abortController)
                  abortController.abort();
                if (startedListening)
                  globalEvents.storagemutated.unsubscribe(mutationListener);
              }
            };
            observer.start && observer.start(subscription);
            var startedListening = false;
            var doQuery = function() {
              return execInGlobalContext(_doQuery);
            };
            function shouldNotify() {
              return obsSetsOverlap(currentObs, accumMuts);
            }
            var mutationListener = function(parts) {
              extendObservabilitySet(accumMuts, parts);
              if (shouldNotify()) {
                doQuery();
              }
            };
            var _doQuery = function() {
              if (closed || !domDeps.indexedDB) {
                return;
              }
              accumMuts = {};
              var subscr = {};
              if (abortController)
                abortController.abort();
              abortController = new AbortController();
              var ctx = {
                subscr,
                signal: abortController.signal,
                requery: doQuery,
                querier,
                trans: null
              };
              var ret = execute(ctx);
              if (!startedListening) {
                globalEvents.storagemutated.subscribe(mutationListener);
                startedListening = true;
              }
              Promise.resolve(ret).then(function(result) {
                hasValue = true;
                currentValue = result;
                if (closed || ctx.signal.aborted) {
                  return;
                }
                if (shouldNotify()) {
                  doQuery();
                } else {
                  currentObs = subscr;
                  if (shouldNotify()) {
                    doQuery();
                  } else {
                    accumMuts = {};
                    execInGlobalContext(function() {
                      return !closed && observer.next && observer.next(result);
                    });
                  }
                }
              }, function(err) {
                hasValue = false;
                if (!["DatabaseClosedError", "AbortError"].includes(err === null || err === void 0 ? void 0 : err.name)) {
                  if (!closed)
                    execInGlobalContext(function() {
                      if (closed)
                        return;
                      observer.error && observer.error(err);
                    });
                }
              });
            };
            setTimeout(doQuery, 0);
            return subscription;
          });
          observable.hasValue = function() {
            return hasValue;
          };
          observable.getValue = function() {
            return currentValue;
          };
          return observable;
        }
        var Dexie2 = Dexie$1;
        props(Dexie2, __assign(__assign({}, fullNameExceptions), {
          delete: function(databaseName) {
            var db = new Dexie2(databaseName, { addons: [] });
            return db.delete();
          },
          exists: function(name) {
            return new Dexie2(name, { addons: [] }).open().then(function(db) {
              db.close();
              return true;
            }).catch("NoSuchDatabaseError", function() {
              return false;
            });
          },
          getDatabaseNames: function(cb) {
            try {
              return getDatabaseNames(Dexie2.dependencies).then(cb);
            } catch (_a2) {
              return rejection(new exceptions.MissingAPI());
            }
          },
          defineClass: function() {
            function Class(content) {
              extend(this, content);
            }
            return Class;
          },
          ignoreTransaction: function(scopeFunc) {
            return PSD.trans ? usePSD(PSD.transless || globalPSD, scopeFunc) : scopeFunc();
          },
          vip,
          async: function(generatorFn) {
            return function() {
              try {
                var rv = awaitIterator(generatorFn.apply(this, arguments));
                if (!rv || typeof rv.then !== "function")
                  return DexiePromise.resolve(rv);
                return rv;
              } catch (e) {
                return rejection(e);
              }
            };
          },
          spawn: function(generatorFn, args, thiz) {
            try {
              var rv = awaitIterator(generatorFn.apply(thiz, args || []));
              if (!rv || typeof rv.then !== "function")
                return DexiePromise.resolve(rv);
              return rv;
            } catch (e) {
              return rejection(e);
            }
          },
          currentTransaction: {
            get: function() {
              return PSD.trans || null;
            }
          },
          waitFor: function(promiseOrFunction, optionalTimeout) {
            var promise = DexiePromise.resolve(typeof promiseOrFunction === "function" ? Dexie2.ignoreTransaction(promiseOrFunction) : promiseOrFunction).timeout(optionalTimeout || 6e4);
            return PSD.trans ? PSD.trans.waitFor(promise) : promise;
          },
          Promise: DexiePromise,
          debug: {
            get: function() {
              return debug;
            },
            set: function(value) {
              setDebug(value);
            }
          },
          derive,
          extend,
          props,
          override,
          Events,
          on: globalEvents,
          liveQuery: liveQuery2,
          extendObservabilitySet,
          getByKeyPath,
          setByKeyPath,
          delByKeyPath,
          shallowClone,
          deepClone,
          getObjectDiff,
          cmp: cmp2,
          asap: asap$1,
          minKey,
          addons: [],
          connections: {
            get: connections.toArray
          },
          errnames,
          dependencies: domDeps,
          cache,
          semVer: DEXIE_VERSION,
          version: DEXIE_VERSION.split(".").map(function(n) {
            return parseInt(n);
          }).reduce(function(p, c, i) {
            return p + c / Math.pow(10, i * 2);
          })
        }));
        Dexie2.maxKey = getMaxKey(Dexie2.dependencies.IDBKeyRange);
        if (typeof dispatchEvent !== "undefined" && typeof addEventListener !== "undefined") {
          globalEvents(DEXIE_STORAGE_MUTATED_EVENT_NAME, function(updatedParts) {
            if (!propagatingLocally) {
              var event_1;
              event_1 = new CustomEvent(STORAGE_MUTATED_DOM_EVENT_NAME, {
                detail: updatedParts
              });
              propagatingLocally = true;
              dispatchEvent(event_1);
              propagatingLocally = false;
            }
          });
          addEventListener(STORAGE_MUTATED_DOM_EVENT_NAME, function(_a2) {
            var detail = _a2.detail;
            if (!propagatingLocally) {
              propagateLocally(detail);
            }
          });
        }
        function propagateLocally(updateParts) {
          var wasMe = propagatingLocally;
          try {
            propagatingLocally = true;
            globalEvents.storagemutated.fire(updateParts);
            signalSubscribersNow(updateParts, true);
          } finally {
            propagatingLocally = wasMe;
          }
        }
        var propagatingLocally = false;
        var bc;
        var createBC = function() {
        };
        if (typeof BroadcastChannel !== "undefined") {
          createBC = function() {
            bc = new BroadcastChannel(STORAGE_MUTATED_DOM_EVENT_NAME);
            bc.onmessage = function(ev) {
              return ev.data && propagateLocally(ev.data);
            };
          };
          createBC();
          if (typeof bc.unref === "function") {
            bc.unref();
          }
          globalEvents(DEXIE_STORAGE_MUTATED_EVENT_NAME, function(changedParts) {
            if (!propagatingLocally) {
              bc.postMessage(changedParts);
            }
          });
        }
        if (typeof addEventListener !== "undefined") {
          addEventListener("pagehide", function(event) {
            if (!Dexie$1.disableBfCache && event.persisted) {
              if (debug)
                console.debug("Dexie: handling persisted pagehide");
              bc === null || bc === void 0 ? void 0 : bc.close();
              for (var _i = 0, _a2 = connections.toArray(); _i < _a2.length; _i++) {
                var db = _a2[_i];
                db.close({ disableAutoOpen: false });
              }
            }
          });
          addEventListener("pageshow", function(event) {
            if (!Dexie$1.disableBfCache && event.persisted) {
              if (debug)
                console.debug("Dexie: handling persisted pageshow");
              createBC();
              propagateLocally({ all: new RangeSet2(-Infinity, [[]]) });
            }
          });
        }
        function add2(value) {
          return new PropModification2({ add: value });
        }
        function remove2(value) {
          return new PropModification2({ remove: value });
        }
        function replacePrefix2(a, b) {
          return new PropModification2({ replacePrefix: [a, b] });
        }
        DexiePromise.rejectionMapper = mapError;
        setDebug(debug);
        var namedExports = /* @__PURE__ */ Object.freeze({
          __proto__: null,
          DEFAULT_MAX_CONNECTIONS,
          Dexie: Dexie$1,
          Entity: Entity2,
          PropModification: PropModification2,
          RangeSet: RangeSet2,
          add: add2,
          cmp: cmp2,
          default: Dexie$1,
          liveQuery: liveQuery2,
          mergeRanges: mergeRanges2,
          rangesOverlap: rangesOverlap2,
          remove: remove2,
          replacePrefix: replacePrefix2
        });
        __assign(Dexie$1, namedExports, { default: Dexie$1 });
        return Dexie$1;
      }));
    }
  });

  // ../../../syncer.c/bindings/wasm/dist/syncer-core.single.mjs
  async function createSyncerModule(moduleArg = {}) {
    var Module = moduleArg;
    var ENVIRONMENT_IS_WEB = !!globalThis.window;
    var ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope;
    var ENVIRONMENT_IS_NODE = globalThis.process?.versions?.node && globalThis.process?.type != "renderer";
    var quit_ = (status, toThrow) => {
      throw toThrow;
    };
    var _scriptName = import_meta.url;
    var scriptDirectory = "";
    var readAsync, readBinary;
    if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
      try {
        scriptDirectory = new URL(".", _scriptName).href;
      } catch {
      }
      {
        if (ENVIRONMENT_IS_WORKER) {
          readBinary = (url) => {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.responseType = "arraybuffer";
            xhr.send(null);
            return new Uint8Array(xhr.response);
          };
        }
        readAsync = async (url) => {
          var response = await fetch(url, { credentials: "same-origin" });
          if (response.ok) {
            return response.arrayBuffer();
          }
          throw new Error(response.status + " : " + response.url);
        };
      }
    } else {
    }
    var out = console.log.bind(console);
    var err = console.error.bind(console);
    var wasmBinary;
    var ABORT = false;
    var EXITSTATUS;
    class EmscriptenEH {
    }
    class EmscriptenSjLj extends EmscriptenEH {
    }
    function binaryDecode(bin) {
      for (var i = 0, l = bin.length, o = new Uint8Array(l), c; i < l; ++i) {
        c = bin.charCodeAt(i);
        o[i] = ~c >> 8 & c;
      }
      return o;
    }
    var runtimeInitialized = false;
    function getMemoryBuffer() {
      return wasmMemory.buffer;
    }
    function updateMemoryViews() {
      if (HEAP8?.buffer?.resizable) return;
      var b = getMemoryBuffer();
      HEAP8 = new Int8Array(b);
      Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
    }
    function preRun() {
    }
    function initRuntime() {
      runtimeInitialized = true;
      wasmExports["g"]();
    }
    function postRun() {
    }
    function abort(what) {
      what = `Aborted(${what})`;
      err(what);
      ABORT = true;
      what += ". Build with -sASSERTIONS for more info.";
      var e = new WebAssembly.RuntimeError(what);
      throw e;
    }
    var wasmBinaryFile;
    function findWasmBinary() {
      return binaryDecode('\0asm\0\0\0\x9B`\x7F\x7F\0`\x7F\x7F\x7F`\x7F\x7F\x7F\x7F`\x7F\x7F`\x7F\0`\x7F\x7F\x7F\0`\0\0`\x7F\x7F\x7F\x7F\x7F`\0\x7F`\x7F~\x7F`\x7F\x7F\x7F\x7F\x7F\x7F`\x7F|\x7F`\x7F\x7F\x7F\x7F\x7F\0`\x7F~~\0`~\x7F\x7F`\x7F~\x7F\x7F\x7F\x7F\0`\x7F~\x7F\x7F`|\x7F|`\x07\x7F|\x7F\x7F\x7F\x7F\x7F\x7F`\x7F|\0`\n\x7F\x7F\x7F\x7F\x7F\x7F\x7F\x7F\x7F\x7F\x7F`	\x7F\x7F\x7F\x7F\x7F\x7F\x7F\x7F\x7F\x7Faa\0\vab\0ac\0ad\0ae\076\f\r\x07	\x07	\n\0\0\n\0\x07\b\b\bp\0	\x07\x82\x80\x80\b\x7FA\x90\x85\v\x079f\0g\0:h\x005i\x006j\x004k\x003l\0\x07m\x002n\0\bo\0p\0+q\x009r\x008s\x007	\0A\v\b/01,"!-.\f?\n\xAA\x80\b6\x8A\b\v\x7F \0E@ \b\v A@O@A\xC0\x80A06\0A\0\v\x7FA A\vjAxq A\vI\x1B! \0A\bk"("	Axq!\b@ 	AqE@ A\x80I\r Aj \bM@ ! \b kA\xA4\x84(\0AtM\r\vA\0\f\v  \bj!\x07@  \bM@ \b k"AI\r   	AqrAr6  j" Ar6 \x07 \x07(Ar6  \f\vA\xDC\x80(\0 \x07F@A\xD0\x80(\0 \bj"\b M\r   	AqrAr6  j" \b k"Ar6A\xD0\x80 6\0A\xDC\x80 6\0\f\vA\xD8\x80(\0 \x07F@A\xCC\x80(\0 \bj" I\r@  k"AO@   	AqrAr6  j"\b Ar6  j" 6\0  (A~q6\f\v  	Aq rAr6  j" (Ar6A\0!\bA\0!\vA\xD8\x80 \b6\0A\xCC\x80 6\0\f\v \x07("Aq\r Axq \bj"\v I\r \v k!\f \x07(\f!@ A\xFFM@ \x07(\b" F@A\xC4\x80A\xC4\x80(\0A~ Avwq6\0\f\v  6\f  6\b\f\v \x07(!\n@  \x07G@ \x07(\b" 6\f  6\b\f\v@ \x07("\x7F \x07Aj \x07("E\r \x07Aj\v!\b@ \b! "Aj!\b ("\r\0 Aj!\b ("\r\0\v A\x006\0\f\vA\0!\v \nE\r\0@ \x07("At"(\xF4\x82 \x07F@ A\xF4\x82j 6\0 \rA\xC8\x80A\xC8\x80(\0A~ wq6\0\f\v@ \x07 \n(F@ \n 6\f\v \n 6\v E\r\v  \n6 \x07("@  6  6\v \x07("E\r\0  6  6\v \fAM@  	Aq \vrAr6  \vj" (Ar6\f\v   	AqrAr6  j" \fAr6  \vj" (Ar6  \f\v !\v \v"@ A\bj\v \b"E@A\0\v  \0A|Ax \0Ak(\0"Aq\x1B Axqj"   K\x1B\x1B \0\x07 \v\xF2\x7FA!@@ \0 O\r\0@@@ A\nk\0\v \0Aj M"E@ \0A\xBF\v  \0k\vE\r\v  \0AjI@ \0A\xF0\v  \0k\vE\r\v \r \0A\xB5	  \0k\v\r\f\v  \0k! \0-\0\0"A\xDC\0F@ AF@A\v AM@A\0! \0-\0A\xF5\0G\rA! \0Aj"\0 O\r@ \0-\0\0-\0\x80"A\xF0G! A\xF0F\r \0Aj"\0 G\r\0\v\f\vA\0! A\vK\r \0-\0A\xF5\0G\r \0-\0-\0\x80 \0-\0-\0\x80A\btr" \0-\0-\0\x80A\bt" \0-\0-\0\x80rrA\xF0\xE1q\r At rA\x80\xF0qA\x80\xB0G\r  \0AjM@A\v \0-\0A\xDC\0G\r  \0A\x07jM@A\v \0-\0\x07A\xF5\0G\r  \0A\bjM@A\v \0-\0\bA rA\xE4\0G\r  \0A	jM@A\v@ \0-\0	A\xC3\0k$\0\0\0\0\0\0\0\0\vA! \0A\nj O\r \0-\0\n-\0\x80A\xF0G\v AK\r\0 \xC0"A\0N\r\0 \0,\0!@@@ Ak\0\v A\xF0qA\xE0F\r A\xE0qA\xC0F AqA\0Gq\r A\xF8qA\xF0G\r A\x07qAO\r\f\v A\xF0qA\xE0F A@Hq\r A\xF8qA\xF0G\r A\xBF\x7FJ\r AtAq AvAqrAkAO\r\f\v A\xF8qA\xF0G\r\0 A\xBF\x7FJ\r\0 \0,\0A\xBF\x7FJ\r\0 AtAq AvAqrAkAI\r\vA\0!\v \v AvAq AtAqr"\0A\x1BG \0A\0Gq\v\x82\f\b\x7F@ \0E\r\0 \0A\bk" \0Ak(\0"Axq"\0j!@ Aq\r\0 AqE\r  (\0"k"A\xD4\x80(\0I\r \0 j!\0@@@A\xD8\x80(\0 G@ (\f! A\xFFM@  (\b"G\rA\xC4\x80A\xC4\x80(\0A~ Avwq6\0\f\v (!\x07  G@ (\b" 6\f  6\b\f\v ("\x7F Aj ("E\r Aj\v!@ ! "Aj! ("\r\0 Aj! ("\r\0\v A\x006\0\f\v ("AqAG\rA\xCC\x80 \x006\0  A~q6  \0Ar6  \x006\0\v  6\f  6\b\f\vA\0!\v \x07E\r\0@ ("At"(\xF4\x82 F@ A\xF4\x82j 6\0 \rA\xC8\x80A\xC8\x80(\0A~ wq6\0\f\v@  \x07(F@ \x07 6\f\v \x07 6\v E\r\v  \x076 ("@  6  6\v ("E\r\0  6  6\v  O\r\0 ("AqE\r\0@@@@ AqE@A\xDC\x80(\0 F@A\xDC\x80 6\0A\xD0\x80A\xD0\x80(\0 \0j"\x006\0  \0Ar6 A\xD8\x80(\0G\rA\xCC\x80A\x006\0A\xD8\x80A\x006\0\vA\xD8\x80(\0"\x07 F@A\xD8\x80 6\0A\xCC\x80A\xCC\x80(\0 \0j"\x006\0  \0Ar6 \0 j \x006\0\v Axq \0j!\0 (\f! A\xFFM@ (\b" F@A\xC4\x80A\xC4\x80(\0A~ Avwq6\0\f\v  6\f  6\b\f\v (!\b  G@ (\b" 6\f  6\b\f\v ("\x7F Aj ("E\r Aj\v!@ ! "Aj! ("\r\0 Aj! ("\r\0\v A\x006\0\f\v  A~q6  \0Ar6 \0 j \x006\0\f\vA\0!\v \bE\r\0@ ("At"(\xF4\x82 F@ A\xF4\x82j 6\0 \rA\xC8\x80A\xC8\x80(\0A~ wq6\0\f\v@  \b(F@ \b 6\f\v \b 6\v E\r\v  \b6 ("@  6  6\v ("E\r\0  6  6\v  \0Ar6 \0 j \x006\0  \x07G\r\0A\xCC\x80 \x006\0\v \0A\xFFM@ \0A\xF8qA\xEC\x80j!\x7FA\xC4\x80(\0"A \0Avt"\0qE@A\xC4\x80 \0 r6\0 \f\v (\b\v!\0  6\b \0 6\f  6\f  \x006\b\vA! \0A\xFF\xFF\xFF\x07M@ \0A& \0A\bvg"kvAq AtrA>s!\v  6 B\x007 AtA\xF4\x82j!\x7F@\x7FA\xC8\x80(\0"A t"qE@A\xC8\x80  r6\0  6\0A!A\b\f\v \0A AvkA\0 AG\x1Bt! (\0!@ "(Axq \0F\r Av! At!  Aqj"("\r\0\v  6A! !A\b\v!\0 "\f\v (\b" 6\f  6\bA!\0A\b!A\0\v!  j 6\0  6\f \0 j 6\0A\xE4\x80A\xE4\x80(\0Ak"\0A\x7F \0\x1B6\0\v\v\xC5(\v\x7F#\0Ak"\n$\0@@@@@@@@@@ \0A\xF4M@A\xC4\x80(\0"A \0A\vjA\xF8q \0A\vI\x1B"Av"\0v"Aq@@ A\x7FsAq \0j"At"A\xEC\x80j"\0 (\xF4\x80"(\b"F@A\xC4\x80 A~ wq6\0\f\v  \x006\f \0 6\b\v A\bj!\0  Ar6  j" (Ar6\f\v\v A\xCC\x80(\0"\bM\r @@A \0t"A\0 kr  \0tqh"At"A\xEC\x80j" (\xF4\x80"\0(\b"F@A\xC4\x80 A~ wq"6\0\f\v  6\f  6\b\v \0 Ar6 \0 j"\x07  k"Ar6 \0 j 6\0 \b@ \bAxqA\xEC\x80j!A\xD8\x80(\0!\x7F A \bAvt"qE@A\xC4\x80  r6\0 \f\v (\b\v!  6\b  6\f  6\f  6\b\v \0A\bj!\0A\xD8\x80 \x076\0A\xCC\x80 6\0\f\v\vA\xC8\x80(\0"\vE\r \vhAt(\xF4\x82"(Axq k! !@@ ("\0E@ ("\0E\r\v \0(Axq k"   I"\x1B! \0  \x1B! \0!\f\v\v (!	  (\f"\0G@ (\b" \x006\f \0 6\b\f\n\v ("\x7F Aj ("E\r Aj\v!@ !\x07 "\0Aj! \0("\r\0 \0Aj! \0("\r\0\v \x07A\x006\0\f	\vA\x7F! \0A\xBF\x7FK\r\0 \0A\vj"Axq!A\xC8\x80(\0"\x07E\r\0A!\bA\0 k! \0A\xF4\xFF\xFF\x07M@ A& A\bvg"\0kvAq \0AtkA>j!\b\v@@@ \bAt(\xF4\x82"E@A\0!\0\f\vA\0!\0 A \bAvkA\0 \bAG\x1Bt!@@ (Axq k" O\r\0 ! "\r\0A\0! !\0\f\v \0 ("   AvAqj("F\x1B \0 \x1B!\0 At! \r\0\v\v \0 rE@A\0!A \bt"\0A\0 \0kr \x07q"\0E\r \0hAt(\xF4\x82!\0\v \0E\r\v@ \0(Axq k" I!   \x1B! \0  \x1B! \0("\x7F  \0(\v"\0\r\0\v\v E\r\0 A\xCC\x80(\0 kO\r\0 (!\b  (\f"\0G@ (\b" \x006\f \0 6\b\f\b\v ("\x7F Aj ("E\r Aj\v!@ ! "\0Aj! \0("\r\0 \0Aj! \0("\r\0\v A\x006\0\f\x07\v A\xCC\x80(\0"M@A\xD8\x80(\0!\0@  k"AO@ \0 j" Ar6 \0 j 6\0 \0 Ar6\f\v \0 Ar6 \0 j" (Ar6A\0!A\0!\vA\xCC\x80 6\0A\xD8\x80 6\0 \0A\bj!\0\f	\v A\xD0\x80(\0"I@A\xD0\x80  k"6\0A\xDC\x80A\xDC\x80(\0"\0 j"6\0  Ar6 \0 Ar6 \0A\bj!\0\f	\vA\0!\0 A/j"\x7FA\x9C\x84(\0@A\xA4\x84(\0\f\vA\xA8\x84B\x7F7\0A\xA0\x84B\x80\xA0\x80\x80\x80\x807\0A\x9C\x84 \nA\fjApqA\xD8\xAA\xD5\xAAs6\0A\xB0\x84A\x006\0A\x80\x84A\x006\0A\x80 \v"j"A\0 k"\x07q" M\r\bA\xFC\x83(\0"@A\xF4\x83(\0"\b j"	 \bM\r	  	I\r	\v@A\x80\x84-\0\0AqE@@@@@A\xDC\x80(\0"@A\x84\x84!\0@ \0(\0"\b M@  \b \0(jI\r\v \0(\b"\0\r\0\v\vA\0"A\x7FF\r !A\xA0\x84(\0"\0Ak" q@  k  jA\0 \0kqj!\v  M\rA\xFC\x83(\0"\0@A\xF4\x83(\0" j"\x07 M\r \0 \x07I\r\v "\0 G\r\f\v  k \x07q"" \0(\0 \0(jF\r !\0\v \0A\x7FF\r A0j M@ \0!\f\vA\xA4\x84(\0"  kjA\0 kq"A\x7FF\r  j! \0!\f\v A\x7FG\r\vA\x80\x84A\x80\x84(\0Ar6\0\v !A\0!\0 A\x7FF\r \0A\x7FF\r \0 M\r \0 k" A(jM\r\vA\xF4\x83A\xF4\x83(\0 j"\x006\0A\xF8\x83(\0 \0I@A\xF8\x83 \x006\0\v@A\xDC\x80(\0"@A\x84\x84!\0@  \0(\0" \0("jF\r \0(\b"\0\r\0\v\f\vA\xD4\x80(\0"\0A\0 \0 M\x1BE@A\xD4\x80 6\0\vA\0!\0A\x88\x84 6\0A\x84\x84 6\0A\xE4\x80A\x7F6\0A\xE8\x80A\x9C\x84(\x006\0A\x90\x84A\x006\0@ \0At" A\xEC\x80j"6\xF4\x80  6\xF8\x80 \0Aj"\0A G\r\0\vA\xD0\x80 A(k"\0Ax kA\x07q"k"6\0A\xDC\x80  j"6\0  Ar6 \0 jA(6A\xE0\x80A\xAC\x84(\x006\0\f\v  M\r  K\r \0(\fA\bq\r \0  j6A\xDC\x80 Ax kA\x07q"\0j"6\0A\xD0\x80A\xD0\x80(\0 j" \0k"\x006\0  \0Ar6  jA(6A\xE0\x80A\xAC\x84(\x006\0\f\vA\0!\0\f\vA\0!\0\f\vA\xD4\x80(\0 K@A\xD4\x80 6\0\v  j!A\x84\x84!\0@@  \0(\0"G@ \0(\b"\0\r\f\v\v \0-\0\fA\bqE\r\vA\x84\x84!\0@@ \0(\0" M@   \0(j"I\r\v \0(\b!\0\f\v\vA\xD0\x80 A(k"\0Ax kA\x07q"k"\x076\0A\xDC\x80  j"6\0  \x07Ar6 \0 jA(6A\xE0\x80A\xAC\x84(\x006\0  A\' kA\x07qjA/k"\0 \0 AjI\x1B"A\x1B6 A\x8C\x84)\x007 A\x84\x84)\x007\bA\x8C\x84 A\bj6\0A\x88\x84 6\0A\x84\x84 6\0A\x90\x84A\x006\0 Aj!\0@ \0A\x076 \0A\bj \0Aj!\0 I\r\0\v  F\r\0  (A~q6   k"Ar6  6\0\x7F A\xFFM@ A\xF8qA\xEC\x80j!\0\x7FA\xC4\x80(\0"A Avt"qE@A\xC4\x80  r6\0 \0\f\v \0(\b\v! \0 6\b  6\fA\f!A\b\f\vA!\0 A\xFF\xFF\xFF\x07M@ A& A\bvg"\0kvAq \0AtrA>s!\0\v  \x006 B\x007 \0AtA\xF4\x82j!@@A\xC8\x80(\0"A \0t"qE@A\xC8\x80  r6\0  6\0\f\v A \0AvkA\0 \0AG\x1Bt!\0 (\0!@ "(Axq F\r \0Av! \0At!\0  Aqj"("\r\0\v  6\v  6A\b! "!\0A\f\f\v (\b"\0 6\f  6\b  \x006\bA\0!\0A!A\f\v j 6\0  j \x006\0\vA\xD0\x80(\0"\0 M\r\0A\xD0\x80 \0 k"6\0A\xDC\x80A\xDC\x80(\0"\0 j"6\0  Ar6 \0 Ar6 \0A\bj!\0\f\vA\xC0\x80A06\0A\0!\0\f\v \0 6\0 \0 \0( j6 Ax kA\x07qj"\b Ar6 Ax kA\x07qj"  \bj"k!\x07@A\xDC\x80(\0 F@A\xDC\x80 6\0A\xD0\x80A\xD0\x80(\0 \x07j"\x006\0  \0Ar6\f\vA\xD8\x80(\0 F@A\xD8\x80 6\0A\xCC\x80A\xCC\x80(\0 \x07j"\x006\0  \0Ar6 \0 j \x006\0\f\v ("\0AqAF@ \0Axq!	 (\f!@ \0A\xFFM@ (\b" F@A\xC4\x80A\xC4\x80(\0A~ \0Avwq6\0\f\v  6\f  6\b\f\v (!@  G@ (\b"\0 6\f  \x006\b\f\v@ ("\0\x7F Aj ("\0E\r Aj\v!@ ! \0"Aj! \0("\0\r\0 Aj! ("\0\r\0\v A\x006\0\f\vA\0!\v E\r\0@ ("\0At"(\xF4\x82 F@ A\xF4\x82j 6\0 \rA\xC8\x80A\xC8\x80(\0A~ \0wq6\0\f\v@  (F@  6\f\v  6\v E\r\v  6 ("\0@  \x006 \0 6\v ("\0E\r\0  \x006 \0 6\v \x07 	j!\x07  	j"(!\0\v  \0A~q6  \x07Ar6  \x07j \x076\0 \x07A\xFFM@ \x07A\xF8qA\xEC\x80j!\0\x7FA\xC4\x80(\0"A \x07Avt"qE@A\xC4\x80  r6\0 \0\f\v \0(\b\v! \0 6\b  6\f  \x006\f  6\b\f\vA! \x07A\xFF\xFF\xFF\x07M@ \x07A& \x07A\bvg"\0kvAq \0AtrA>s!\v  6 B\x007 AtA\xF4\x82j!\0@@A\xC8\x80(\0"A t"qE@A\xC8\x80  r6\0 \0 6\0\f\v \x07A AvkA\0 AG\x1Bt! \0(\0!@ "\0(Axq \x07F\r Av! At! \0 Aqj"("\r\0\v  6\v  \x006  6\f  6\b\f\v \0(\b" 6\f \0 6\b A\x006  \x006\f  6\b\v \bA\bj!\0\f\v@ \bE\r\0@ ("At"(\xF4\x82 F@ A\xF4\x82j \x006\0 \0\rA\xC8\x80 \x07A~ wq"\x076\0\f\v@  \b(F@ \b \x006\f\v \b \x006\v \0E\r\v \0 \b6 ("@ \0 6  \x006\v ("E\r\0 \0 6  \x006\v@ AM@   j"\0Ar6 \0 j"\0 \0(Ar6\f\v  Ar6  j" Ar6  j 6\0 A\xFFM@ A\xF8qA\xEC\x80j!\0\x7FA\xC4\x80(\0"A Avt"qE@A\xC4\x80  r6\0 \0\f\v \0(\b\v! \0 6\b  6\f  \x006\f  6\b\f\vA!\0 A\xFF\xFF\xFF\x07M@ A& A\bvg"\0kvAq \0AtrA>s!\0\v  \x006 B\x007 \0AtA\xF4\x82j!@@ \x07A \0t"qE@A\xC8\x80  \x07r6\0  6\0  6\f\v A \0AvkA\0 \0AG\x1Bt!\0 (\0!@ "(Axq F\r \0Av! \0At!\0  Aqj"\x07("\r\0\v \x07 6  6\v  6\f  6\b\f\v (\b"\0 6\f  6\b A\x006  6\f  \x006\b\v A\bj!\0\f\v@ 	E\r\0@ ("At"(\xF4\x82 F@ A\xF4\x82j \x006\0 \0\rA\xC8\x80 \vA~ wq6\0\f\v@  	(F@ 	 \x006\f\v 	 \x006\v \0E\r\v \0 	6 ("@ \0 6  \x006\v ("E\r\0 \0 6  \x006\v@ AM@   j"\0Ar6 \0 j"\0 \0(Ar6\f\v  Ar6  j" Ar6  j 6\0 \b@ \bAxqA\xEC\x80j!\0A\xD8\x80(\0!\x7FA \bAvt"\x07 qE@A\xC4\x80  \x07r6\0 \0\f\v \0(\b\v! \0 6\b  6\f  \x006\f  6\b\vA\xD8\x80 6\0A\xCC\x80 6\0\v A\bj!\0\v \nAj$\0 \0\v\xC0\x7F \0-\0\0A qE@@ \0("\x7F  \0&\r \0(\v \0("k I@ \0   \0($\0\f\v@@ \0(PA\0H\r\0 E\r\0 !@  j"Ak-\0\0A\nG@ Ak"\r\f\v\v \0   \0($\0 I\r  k! \0(!\f\v !\v   \x1B \0 \0( j6\v\v\vj\x7F#\0A\x80k"$\0@  L\r\0 A\x80\xC0q\r\0    k"A\x80 A\x80I"\x1B* E@@ \0 A\x80	 A\x80k"A\xFFK\r\0\v\v \0  	\v A\x80j$\0\v\x81\x7F@@ AO@ \0 rAq\r@ \0(\0 (\0G\r Aj! \0Aj!\0 Ak"AK\r\0\v\v E\r\v@ \0-\0\0" -\0\0"F@ Aj! \0Aj!\0 Ak"\r\f\v\v  k\vA\0\v\xEE\x07\v\x7F~@ E\r\0 \0A(j!A (\b )\0B\x83BR\x1B"Au"\n \0(, \0(("	kAmK@  \0Aj \nE\r (\0!	\v  	 \nAlj6\0 	E\r\0 @  j!\f \0Aj! \0Aj!\n 	!\x07@ \x07 )\0"\r7\0 \x07 )\b7\b@@ \r\xA7"AqAF@@@ (\0"\vA\x7FF\r\0 (\b! \v \0( \0("kO@A\0!\b@ \vAj"AwK\r\0 \n(\f (\b" A\bj"  K\x1B" \n(\0\0"E\r\0 (!  6  6\0   j6  A\bj6\0  6A!\b  (\f" (\b"At"   K\x1B"  K\x1B6\b\v \bE\r (\0!\v   \vj"Aj6\0 \r\v \x07A\x006\bA\0\v \v@   \v\xFC\n\0\0\v A\0:\0\0\f\v@@ A\x07qAk\0\v (\0"E\r \x07Aj"\b!@ AF\r\0 Aj! Aq\x7F  \x07 \bA ( )B\x83BR\x1B"AuAlj"6(  j! Ak\v! AF\r\0@  A (\b )\0B\x83BR\x1B"AuAlj"6  A  j"(\b )\0B\x83BR\x1B"AuAlj"6  j! Ak"AK\r\0\v\v  \b6\f\v (\0"E\r \x07Aj"\b!@ AF\r\0\x7F Aq@ Aj! \f\v ((! ) !\r \x07 \x07A0j6( \x07 \bA  \rB\x83BR\x1B"AjAuAlj"6@ A j j! Ak\v! AF\r\0@ (! )!\r  Aj6  A  \rB\x83BR\x1B"AjAuAlj"6( Aj j"(! )!\r  Aj6  A  \rB\x83BR\x1B"AjAuAlj"6( Aj j! Ak"AK\r\0\v\v  \b6(  Aj6\v \x07 6\b\v \x07Aj!\x07 Aj" \fI\r\0\v\v 	!\v \vi~ \0 B \x88" B \x88"~ B\xFF\xFF\xFF\xFF\x83" B\xFF\xFF\xFF\xFF\x83"~"B \x88  ~|"B \x88|  ~ B\xFF\xFF\xFF\xFF\x83|"B \x88|7\b \0 B\xFF\xFF\xFF\xFF\x83 B \x86\x847\0\v}\x7F@@ \0"AqE\r\0 -\0\0E@A\0\v@ Aj"AqE\r -\0\0\r\0\v\f\v@ "Aj!A\x80\x82\x84\b (\0"k rA\x80\x81\x82\x84xqA\x80\x81\x82\x84xF\r\0\v@ "Aj! -\0\0\r\0\v\v  \0k\v\xE9\b\b\x7F~|#\0A\xE0\0k"\b$\0\x7F @ Aj!\v@@\x7F \'"\n@ \n k\f\v \v"\x07E\r\0@ -\0\0A F@ Aj! \x07Ak"\x07\r\f\v\v@  \x07jAk-\0\0A F@ \x07Ak"\x07\r\f\v\vA\0!@ \0)\0"\fB\x07\x83B\x07R\r\0 \fB\b\x88\xA7"E\r\0 \0(\b!@@ (("(\0 \x07F@ (\b  \x07\vE\r\v Ak"\r\f\v\v (!\v )\0"\fB\x07\x83B\x07R\r\0 \v! \fB\b\x88\xA7"E\r\0@@ (\0 \x07F@ (\b  \x07\vE\r\v AjA ( )B\x83BR\x1Bj! Ak"\r\f\v\v E\r\0\x7F@ )\0"\rB\xF7\x83BR"	\r\0 )B\xF7\x83BR\r\0 )\b"\r )"\fU \f \rUk\f\v\x7F \rB\x07\x83"\fBQ@A\0 )"\fB\x07\x83BR\rD\0\0\0\0\0\0\0\0!D\0\0\0\0\0\0\0\0!@@@@ \r\xA7A\xFFqAk\0\v +\b!\f\v )\b\xB9!\f\v )\b\xBA!\v@@@@ \f\xA7A\xFFqAk\0\v +!\f\v )\xB9!\f\v )\xBA!\v  c  dk\f\vA\0 \fBR\r\0 (\b\v!A\0! )B\x07\x83BQ@ (!\v@ \r\0 	\r\0 \b )\b7 \bA@k"AA\x9F\f \bAj\v E@ )B\xF7\x83BR\r \b )7\0 \bA j"AA\x9F\f \b\v E\rA\0!\x07 ! !@@ E\r\0@  \x07j-\0\0A0kA\xFFqA\nO\r \x07Aj"\x07 G\r\0\vA\0!\x07 E\r\0@  \x07j-\0\0A0kA\xFFqA\nO\r \x07Aj"\x07 G\r\0\vA!\x07@ AG@  jAk@ -\0\0A0G\r Aj! Ak"AK\r\0\v!\vA!\v@ AF\r\0  jAk@ -\0\0A0G@ !\x07\f\v Aj! Ak"AK\r\0\v!\v  \x07F\rA\x7FA  \x07I\x1B\f\v  \f\v \x7F -\0\0"\x7F@@  -\0\0"	G\r 	E\r Ak"E\r Aj! -\0! Aj! \r\0\vA\0!\v A\0\v -\0\0kA\0\v\v!@ @ A\0N\r\f\v A\0L\r\vA\f\v \nAj! \n\r\0\v\vA\0\v \bA\xE0\0j$\0\vW\x7F~@A\xB0\x80(\0"\xAD \0\xADB\x07|B\xF8\xFF\xFF\xFF\x83|"B\xFF\xFF\xFF\xFFX@ \xA7"\0?\0AtM\r \0\r\vA\xC0\x80A06\0A\x7F\vA\xB0\x80 \x006\0 \v\x8A\x7F~ \0B\x80\x80\x80\x80Z@@ Ak" \0" \0B\n\x80"\0B\xF6~|\xA7A0r:\0\0 B\xFF\xFF\xFF\xFF\x9FV\r\0\v\v \0\xA7! \0B\nZ@@ Ak" " A\nn"A\xF6ljA0r:\0\0 A\xE3\0K\r\0\v\v @ Ak" A0r:\0\0\v \v\xF9,	\x7F\n~#\0A k"\n$\0\x7FA\0 B4\x88\xA7A\xFFq"A\xFFF\r\0 \0A-:\0\0 \0 B?\x88\xA7j! B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\0\x83P@ A\xB0\xDC\xC06\0\0 Aj\f\v B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83!\v @ \vB\x80\x80\x80\x80\x80\x80\x80\b\x84!\f@ A\xFF\x07kA4K\r\0A\xB3\b k"\0 \fz\xA7K\r\0\x7F \f \0\xAD\x88"B\xFF\xC1\xD7/X@ \xA7!\0 B\xE3\0X@  B\nT" \0Atr/\0\xA0j;\0\0  kAj\f\v B\x8F\xCE\0X@  B\xE8\x07T" \0A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\x9C\x7Fl \0jAt/\xA0j;\0 Aj\f\v B\xBF\x84=X@  B\xA0\x8DT" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl \0j"\0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl \0jAt/\xA0j;\0 Aj\f\v  B\x80\xAD\xE2T" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl \0j"\0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l \0jAt/\xA0j;\0 A\bj\f\v B\x80\xC2\xD7/\x80"\v\xA7!\0 \vB\x80\xBE\xA8\xD0~ |"\f\xA7!\x7F B\xFF\xC7\xAF\xA0%X@  B\x80\x94\xEB\xDCT" \0Atr/\0\xA0j;\0\0  kAj\f\v B\xFF\x9F\x94\xA5\x8DX@  B\x80\xD0\xDB\xC3\xF4T" \0A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\x9C\x7Fl \0jAt/\xA0j;\0 Aj\f\v B\xFF\xFF\xE8\x83\xB1\xDEX@  B\x80\xC0\xCA\xF3\x84\xA3T" \vB\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl \0j"\0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl \0jAt/\xA0j;\0 Aj\f\v  B\x80\x80\x9A\xA6\xEA\xAF\xE3T" \vB\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl \0j"\0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l \0jAt/\xA0j;\0 A\bj\v"\0 \fB\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\0 \0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0A\bj\v"\0A\xAE\xE0\0;\0\0 \0Aj\f\v A\xB3\bk"A\x85\xA2l!~@ \vP"\r\0 \nAjA\xB8\xC0\0 Au"\0At"\x07k)\0 \f \0A\x95\xDBrlAu j"Aj\xAD\x86"\v\rA\xB0\xC0\0 \x07k)\0"B\xFF\xFF\xFF\xFF\x83"\r \vB\xFF\xFF\xFF\xFF\x83"~"B \x88  B \x88"~|"B \x88  \vB \x88"\v~| \v \r~ B\xFF\xFF\xFF\xFF\x83|"\vB \x88| B\xFF\xFF\xFF\xFF\x83 \vB \x86\x84"\r \n)|"\v \rT\xAD|"B\n\x82!\r \vB\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FQ\r\0 A k\xAD\x88" \rB<\x86 \vB\x88\x84"Q\r\0  |"B\x81\x80\x80\x80\x80\x80\x80\x80\xE0\0|BT\r\0  \r}B\n \r \vB?\x88|B\0  V\x1B B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x9F\x7FV\x1B|\f\v \nA\xB8\xC0\0 A\xDB\xFEwA\0  AGq"\x1BjAu"\0At"k)\0B|" \fB\x86" \xAD\x84B}  \0A\x95\xDBrlAujA\xB2\bk\xAD"\x86"\f\r B\x83"A\xB0\xC0\0 k)\0"\vB\xFF\xFF\xFF\xFF\x83" \fB\xFF\xFF\xFF\xFF\x83"\r~"B \x88 \vB \x88"\v \r~|"\rB \x88 \v \fB \x88"\f~|  \f~ \rB\xFF\xFF\xFF\xFF\x83|"\fB \x88| B\xFF\xFF\xFF\xFF\x83 \fB \x86\x84"\f \n)\b|"\r \fT\xAD| \rBV\xAD\x84|!  B\x84 \x86"\rB\xFE\xFF\xFF\xFF\x83"\f~"B \x88 \v \f~|"B \x88 \v \rB \x88"\r~|  \r~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\xFE\xFF\xFF\xFF\x83 B \x86\x84" B \x88" \f~ \f B\xFF\xFF\xFF\xFF\x83"\f~B \x88|"B \x88 \r ~|| \f \r~ B\xFF\xFF\xFF\xFF\x83|B \x88|"\r T\xAD| \rBV\xAD\x84 }!@   \x86"B\xFC\xFF\xFF\xFF\x83"\r~"B \x88 \v \r~|"B \x88 \v B \x88"~|  ~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\xFC\xFF\xFF\xFF\x83 B \x86\x84"  ~ \r ~ \f \r~B \x88|"\vB \x88|| \f ~ \vB\xFF\xFF\xFF\xFF\x83|B \x88|"\v T\xAD|"B(T\r\0  B(\x80"\fB(~"\rV  \rB(|Z"s\r\0 \fB\n~B\nB\0 \x1B|\f\v B\x88"\f  \vBV\xAD\x84"\v B|\x83"B\x84"\rV \f\xA7 \v \rQqr  B|Z"   Ts\x1B\xADB\x83|\v!AA B\xFF\xFF\x83\xFE\xA6\xDE\xE1V\x1B \0j"AjAM@ B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0 B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0 B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0\b B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0\0 A kA\0 A\0L\x1Bj" B\x80\xC2\xD7/\x80"\v\xA7"	A\x90\xCE\0n"\xADB\xDD\x9E\n~B\x88\xA7"A)lA\fv"\x07A0j:\0\0  \x07A\0Gj"\0 A\x9C\x7Fl j"\bAt/\xA0j;\0 \0 \x07A\x9C\x7Fl j"At/\xA0j;\0\0 A\xF0\xB1\x7Fl 	j!\x7F \vB\x80\xBE\xA8\xD0~ |"\xA7"	@ \0 A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0 B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\b \0 A\x9C\x7Fl j"\x07At/\xA0j;\0\n A\xF0\xB1\x7Fl 	j"@ \0 A\xFB(lAv"At/\xA0j;\0\f \0 A\x9C\x7Fl j"At/\xA0j;\0 -\0\xF0k -\0\xF0kAj \x1B!A\f\v \x07-\0\xF0k -\0\xF0kAj \x07\x1B!A\f\f\v @ \0 A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl j"At/\xA0j;\0 -\0\xF0k -\0\xF0kAj \x1B!A\b\f\v \b-\0\xF0kA\0 -\0\xF0k \b\x1Bj!A\v!  A\0 A\0J"\x07\x1Bj")\0\0!  \x07j"\b )\0\b7\0\b \b 7\0\0 A  AL\x1BjA.:\0\0  jAj" \0 j k \x07j"\0 \0 I\x1B\f\v  B\x80\xC2\xD7/\x80"\v\xA7"	A\x90\xCE\0n"\xADB\xDD\x9E\n~B\x88\xA7"\x07A)lA\fv"A0j:\0 AA \x1B"j"\0 \x07A\x9C\x7Fl j"\bAt/\xA0j;\0 \0 A\x9C\x7Fl \x07j"\x07At/\xA0j;\0\0 A\xF0\xB1\x7Fl 	j!\x7F \vB\x80\xBE\xA8\xD0~ |"\xA7"	@ \0 A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0 B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\b \0 A\x9C\x7Fl j"\x07At/\xA0j;\0\n A\xF0\xB1\x7Fl 	j"@ \0 A\xFB(lAv"At/\xA0j;\0\f \0 A\x9C\x7Fl j"\0At/\xA0j;\0 Ar \0-\0\xF0k -\0\xF0kAj \0\x1Bk\f\v A\fr \x07-\0\xF0k -\0\xF0kAj \x07\x1Bk\f\v @ \0 A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl j"\0At/\xA0j;\0 A\br \0-\0\xF0k -\0\xF0kAj \0\x1Bk\f\vAA \x1B \b-\0\xF0kA\0 \x07-\0\xF0k \b\x1Bjk\v!\0 -\0! A.:\0  :\0\0 \0 j \0AFk"\0A\xE5\xDA\0;\0\0 \0AA A\0L\x1Bj!\0 Ak" Au"s k"A\xE3\0M@ \0 A\nI" Atr/\0\xA0j;\0\0 \0 kAj\f\v \0 A\x90lAv"A0j:\0\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0Aj\f\v~@ \vP\r\0 \vB\x88"\fB\x92\xB7\xE7\xF0	~ \vB\x86B\xF8\xFF\xFF\xFF\x83"\rB\xA9\xB7\x8C\xA7\v~"B \x88 \rB\x92\xB7\xE7\xF0	~|"B \x88| \fB\xA9\xB7\x8C\xA7\v~ B\xFF\xFF\xFF\xFF\x83|"B \x88| \fB\xC2\xC5\x9E\xE0~ \rB\xC2\xC5\x9E\xE0~ \rB\xD1\x8D\x8D\xD4~B \x88|"\rB \x88| \fB\xD1\x8D\x8D\xD4~ \rB\xFF\xFF\xFF\xFF\x83|B \x88|"\r B\xF8\xFF\xFF\xFF\x83 B \x86\x84|"\f \rT\xAD|"B\n\x82!\r \fB\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FQ\r\0 \rB<\x86 \fB\x88\x84"B\x95\xF2\x9C\x96\xB5\xA3\xE2\xBC\xF8\0}BT\r\0 B\xEA\x8D\xE3\xE9\xCA\xDC\x9D\xC3\'Q\r\0  \r}B\n \r \fB?\x88|B\0 B\xEA\x8D\xE3\xE9\xCA\xDC\x9D\xC3\'V\x1B B\x96\xF2\x9C\x96\xB5\xA3\xE2\xBC\xF8\0}B\x80\x80\x80\x80\x80\x80\x80\x80\xE0\0T\x1B|\f\v \vB\x1B\x88"\fB\x92\xB7\xE7\xF0	~" \vB\x86"B\xE0\xFF\xFF\xFF\x83"\vB\x84"\rB\xA9\xB7\x8C\xA7\v~"B \x88 \rB\x92\xB7\xE7\xF0	~|"B \x88| \fB\xA9\xB7\x8C\xA7\v~" B\xFF\xFF\xFF\xFF\x83|"B \x88| \fB\xC2\xC5\x9E\xE0~" \rB\xC2\xC5\x9E\xE0~ \rB\xD2\x8D\x8D\xD4~B \x88|"\rB \x88| \fB\xD2\x8D\x8D\xD4~" \rB\xFE\xFF\xFF\xFF\x83|B \x88|"\f B\xF0\xFF\xFF\xFF\x83 B \x86\x84|"\r \fT\xAD| \rBV\xAD\x84 B\x83"}!\r  B}"\fB\xF0\xFF\xFF\xFF\x83"B\xA9\xB7\x8C\xA7\v~"B \x88 B\x92\xB7\xE7\xF0	~|"B \x88 \fB \x88"\fB\x92\xB7\xE7\xF0	~| \fB\xA9\xB7\x8C\xA7\v~ B\xFF\xFF\xFF\xFF\x83|"B \x88| \fB\xC2\xC5\x9E\xE0~ B\xC2\xC5\x9E\xE0~ B\xD2\x8D\x8D\xD4~B \x88|"B \x88| \fB\xD2\x8D\x8D\xD4~ B\xFE\xFF\xFF\xFF\x83|B \x88|" B\xF0\xFF\xFF\xFF\x83 B \x86\x84|"\f T\xAD| \fBV\xAD\x84|!\f@  \vB\x92\xB7\xE7\xF0	~ \vB\xA9\xB7\x8C\xA7\v~"B \x88|"B \x88| B\xFF\xFF\xFF\xFF\x83 |"B \x88| \vB\xC2\xC5\x9E\xE0~ \vB\xD2\x8D\x8D\xD4~B \x88|"\vB \x88 | \vB\xFE\xFF\xFF\xFF\x83 |B \x88|"\v B\xE0\xFF\xFF\xFF\x83 B \x86\x84|" \vT\xAD|"B(T\r\0 \f B(\x80"\vB(~"V \r B(|Z"\0s\r\0 \vB\n~B\nB\0 \0\x1B|\f\v B\x88"\v  BV\xAD\x84" B\xFC\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x83"B\x84"V \v\xA7  Qqr \r B|Z"\0 \0  \fTs\x1B\xADB\x83|\v! Aj!\0\x7F B\x80\x80\x9A\xA6\xEA\xAF\xE3Z@ \0 B\x80\x80\x84\xFE\xA6\xDE\xE1\x80"\v\xA7A0j:\0\0 \0 B\xFF\xFF\x83\xFE\xA6\xDE\xE1Vj"\0  B\x80\xC2\xD7/\x80"B\x80\xBE\xA8\xD0~|"\fB\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\b \0 \vB\x80\xBE\xA8\xD0~ |"B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\0 \0 \f\xA7 A\xF0\xB1\x7Flj"\x07A\xFB(lAv"\bAt/\xA0j;\0\f \0 A\x9C\x7Fl jAt/\xA0j;\0\n \0 \xA7 A\xF0\xB1\x7Flj"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 \bA\x9C\xFF\xFF\xFF\x07l \x07jAt/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0Aj\f\v B\x80\xC2\xD7/Z@ B\x80\xC2\xD7/\x80"\v\xA7! \vB\x80\xBE\xA8\xD0~ |"\f\xA7!\x7F B\xFF\xC7\xAF\xA0%X@ \0 B\x80\x94\xEB\xDCT" Atr/\0\xA0j;\0\0 \0 kAj\f\v B\xFF\x9F\x94\xA5\x8DX@ \0 B\x80\xD0\xDB\xC3\xF4T" A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v B\xFF\xFF\xE8\x83\xB1\xDEX@ \0 B\x80\xC0\xCA\xF3\x84\xA3T" \vB\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v  \vB\xBB\xF1\xB64~B(\x88\xA7"\0A\xFB(lAv"At/\0\xA1j;\0  \0A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl \0jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj\v"\0 \fB\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\0 \0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0A\bj\f\v \xA7! B\xE3\0X@ \0 B\nT" Atr/\0\xA0j;\0\0 \0 kAj\f\v B\x8F\xCE\0X@ \0 B\xE8\x07T" A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v B\xBF\x84=X@ \0 B\xA0\x8DT" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v \0 B\x80\xAD\xE2T" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0A\bj\v! -\0!\0 A.:\0  \0:\0\0  Ak-\0\0A0Fk"\0 \0Ak-\0\0A0Fk!\0@ \0"Ak"\0-\0\0"A0F\r\0\v  A.Fk"\0A\xE5\xDA\0;\0\0 \0AA  k"A\xC5J\x1Bj!\0 A\xC6k" Au"s k"A\xE3\0M@ \0 A\nI" Atr/\0\xA0j;\0\0 \0 kAj\f\v \0 A\x90lAv"A0j:\0\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0Aj\v \nA j$\0\vM\x7F -\0\0!@ \0-\0\0"E\r\0  G\r\0@ -\0! \0-\0"E\r Aj! \0Aj!\0  F\r\0\v\v  k\v\xA9\x7F#\0Ak"\x07$\0 \x07 6\f#\0A\xA0k"$\0  \0 A\x9Ej \x1B"\x006\x94   A\0Gk6\x98 A\0A\x90\xFC\v\0 A\x7F6L A6$ A\x7F6P  A\x9Fj6,  A\x94j6T \0A\0:\0\0#\0A\xD0k"$\0  6\xCC A\xA0j"\0A\0A(\xFC\v\0  (\xCC6\xC8A\0  A\xC8j A\xD0\0j \0%A\0H\x7FA\x7F  (\0"A_q6\0\x7F@@ (0E@ A\xD0\x0060 A\x006 B\x007 (,!  6,\f\v (\r\vA\x7F &\r\v   A\xC8j A\xD0\0j A\xA0j%\v! @ A\0A\0 ($\0 A\x0060  6, A\x006 (!\0 B\x007 A\x7F \0\x1B!\v  (\0"\0 A qr6\0A\x7F  \0A q\x1B\v A\xD0j$\0 A\xA0j$\0 \x07Aj$\0\v\x9F	\x07\x7F\x07~ E@ \0 7\b \0A6\0\vA\x81!  -\0\0A4K\xAD}!@  k  I  KqkAj"\bA\x81I@ \b!\f\v  \bkA\x81j"  AjFk!\v  (\0 kAj6\0 \0 7\bA!\n \0A6\0  I@ \0A\bj!	A\0! \bA\x81I!\vA!A!\x07@@@@  G@ B\n~ -\0\0A0k\xADB\xFF\x83|! Aj!@ \v\r\0  G\r\0  B\n\x82}B|!\v@ Aj"AF@A\0!@ E\r\0@ 	 Atj)\0B\0R\r Aj" G\r\0\v\f\vB\0!  O\r@ 	 Atj"\b  \b)\0"B\xFF\xFF\xFF\xFF\x83"\rB\x80\x80\xA0\xCF\b~"B \x88 \rB\x84\xC6\x9C\xD6\b~|"\rB\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"7\0  V\xAD B\x84\xC6\x9C\xD6\b~ \rB \x88| B \x88||! Aj" G\r\0\v "\b!\x07 B\0R\r\f\v  G\r !\b AN@@ !A\0!@@ \x07E\r\0@ 	 Atj)\0B\0R\r Aj" \x07G\r\0\v\f\vB\0!  \x07O\r\0@ 	 Atj"\f  \f)\0"B\xFF\xFF\xFF\xFF\x83"\rB\x80\x80\xA0\xCF\b~"B \x88 \rB\x84\xC6\x9C\xD6\b~|"\rB\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"7\0  V\xAD B\x84\xC6\x9C\xD6\b~ \rB \x88| B \x88||! Aj" \x07G\r\0\v P\r\0 \0 \x07Aj"\n6\0 	 \x07Atj 7\0 \n"\b!\x07\v Ak! A%J\r\0\v\v E\r AtA\x80\xE9\0j)\0!A\0!@ \x07E\r\0@ 	 Atj)\0B\0R\r Aj" \x07G\r\0\v\f\v  \x07O\r B\xFF\xFF\xFF\xFF\x83!\r B \x88!B\0!@ 	 Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" \r~"B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" \r~|"B \x86 B\xFF\xFF\xFF\xFF\x83\x84"|"7\0  V\xAD  ~ B \x88| B \x88||! Aj" \x07G\r\0\v \x07! P\r\v \0 Aj"\n6\0 	 Atj 7\0 \n"\b!\x07\f\v Aj!\f\v "\b!\x07\v 	 	)\0" |"\r7\0B\0!A\0!  \rX@ \b!\f\vA!\x07 \nAO@@ 	 \x07Atj"\b)\0"B\x7FR@ \b B|7\0 \n"!\x07\f\v \bB\x007\0 \x07Aj"\x07 \nG\r\0\v\v \0 \nAj"6\0 	 \nAtjB7\0 "\n!\x07\v  I\r\0\v\v\v\xCCQ\x7F~@@@@ \0E\r\0 \0)\0"\xA7!@@@@@ AqAF B\x80\xFE\xFF\xFF\xFF\x83B\0RqE@@@ A\x07qAk\x07\0\x07\b\v B\b\x88\xA7"A\xA6\xD5\xAA\xD5K\r\x07 \0(\b!\0 Aj\b"E\r\x07 @  \0 \xFC\n\0\0\v  j!\f	\v B\b\x88\xA7"A\xA6\xD5\xAA\xD5K\r \0(\b! AlAj\b"\0E\r \0A":\0\0 B\x83B\0R\r\x07  j!\f \0!@ Aj!\x7F@@@@@@@@ \f k"AL\r\0@@@@@@@@@@@@ -\0\0"-\0\xC0p\r -\0-\0\xC0p\r\r -\0-\0\xC0p\r -\0-\0\xC0p\r -\0-\0\xC0pE@ -\0-\0\xC0p\r -\0-\0\xC0p\r -\0\x07-\0\xC0p\r -\0\b-\0\xC0p\r -\0	-\0\xC0p\r -\0\n-\0\xC0p\r\x07 -\0\v-\0\xC0p\r\b -\0\f-\0\xC0p\r	 -\0\r-\0\xC0p\r\n -\0-\0\xC0p\r\v -\0-\0\xC0p\r\f  )\0\b7\0\b  )\0\x007\0\0 Aj! \f Aj"k"AL\r\r\f\v\v  (\0\x006\0\0 Aj! Aj!\f\v  -\0:\0  (\0\x006\0\0 Aj! Aj!\f\v  /\0;\0  (\0\x006\0\0 Aj! Aj!\f\v  (\06\0  (\0\x006\0\0 A\x07j! A\x07j!\f\v  )\0\x007\0\0 A\bj! A\bj!\f\v  -\0\b:\0\b  )\0\x007\0\0 A	j! A	j!\f\r\v  /\0\b;\0\b  )\0\x007\0\0 A\nj! A\nj!\f\f\v  (\0\x076\0\x07  )\0\x007\0\0 A\vj! A\vj!\f\v\v  (\0\b6\0\b  )\0\x007\0\0 A\fj! A\fj!\f\n\v  )\07\0  )\0\x007\0\0 A\rj! A\rj!\f	\v  )\07\0  )\0\x007\0\0 Aj! Aj!\f\b\v  )\0\x077\0\x07  )\0\x007\0\0 Aj! Aj!\f\x07\v AL\r@ -\0\0"-\0\xC0p\r\x07 -\0-\0\xC0p\r -\0-\0\xC0p\r -\0-\0\xC0p\r  (\0\x006\0\0 Aj! \f Aj"kAJ\r\0\v\f\v  :\0\0 Aj! Aj!\f\v  /\0\0;\0\0\f\v  -\0:\0  /\0\0;\0\0\f\vA\f\vA\f\v@@@@  \fO\r\0A\0!\x07 ! \f k"Aq"@@ -\0\0"-\0\xC0p@ !\f\x07\v  :\0\0 Aj! Aj! \x07Aj"\x07 G\r\0\v\v AkAI\r\0  \fj k!@ -\0\0"-\0\xC0p@ !\f\v  :\0\0 -\0"-\0\xC0p\r  :\0 -\0"-\0\xC0p\r  :\0 -\0"-\0\xC0p\r  :\0 Aj! Aj" G\r\0\v\v A":\0\0 Aj! \0!\f\v Aj! Aj!\f\v Aj! Aj!\f\v Aj! Aj!\vA\0\v!@@@@@@@@@@@@@ \0\v@ Aj" \fK"E@ -\0\0"\x07-\0\xC0p!\f\v  \fF\r\n \f k -\0\0"\x07-\0\xC0p"AvH\r\v@@ A\xFFq\n\0\x07\b	\n\v\v  \x07:\0\0 Aj!\f\r\v /\0\0"A\xE0\x81qA\xC0\x81G\r AqE\r  ;\0\0A!\f\v\v Aj! Aj!\f	\v@ E@ (\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0G\r\f\v /\0\0" -\0Atr"A\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0F\r\v  6\0\0A!\f	\v Aj! Aj!\f\x07\v (\0\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r A\x87\xE0\0qE\r AqA\0 A\x83\xE0\0q\x1B\r  6\0\0 Aj! !\f\v  \x07At/\xC0v;\0\0 Aj! Aj!\f\v A\xDC\xEA\xC1\x816\0\0  -\0\0At/\xC0r;\0 Aj! Aj!\f\v /\0\0"A\xE0\x81qA\xC0\x81G\r AqE\r A\xDC\xEA;\0\0  AvAqA\xC0\xF2\0j/\0;\0  A\bvA?q AtrA\xFFqAt/\xC0r;\0 Aj! Aj!\f\v /\0\0" -\0"AtrA\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0F\r A\xDC\xEA;\0\0  AvA\xC0q" A?qrA\xFFqAt/\xC0r;\0  A\ft rA\x07vA\xFEqA\xC0\xF2\0j/\0;\0 Aj! Aj!\f\v (\0\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\r A\x87\xE0\0qE\r\r AqA\0 A\x83\xE0\0q\x1B\r\r A\xDC\xEA;\0 A\xDC\xEA;\0\0  AvAq/\xF8u;\0\b  AvA?q A\nv"A\xC0qrAt/\xC0r;\0\n  AtA\x80\x80\xF0\0q AtA\x80\xE0qrA\x80\x80k" A\x80qrA	vA\xFEq/\xC0r;\0  AvA\xB0jA\xFE\xFFq/\xC0r;\0 A\fj! !\f\v A":\0\0 Aj! \0!\f\v\vA\0!\f\0\v\0\v\0\v AlA\xC6\0jAxq"\b\b"E\r A\xFB\0A\xDB\0 B\x07\x83"B\x07Q"\x07\x1B:\0\0 B\b\x88\xA7 \x07t! Aj! \0(\b!  \bj"!\r B\x07Q\x7FA\0A\v!@@ E@ (!A!\f\v \x07!\v ! !\f@ \vA\xFFq!@\x7F@@@@@ \f("\f)\0"\xA7"A\x07q"	Ak\0\v B\b\x88\xA7"A\xA6\xD5\xAA\xD5K\r\b \f(\b!   AlAj"\x07jM@ \bAv" \x07  \x07K\x1BA\x07jAxq" \bA\x7FsK\r	   \bj"\b"\x07E\r	 \x07 \b \r k"	kj! 	@  \x07  kj 	\xFC\n\0\0\v \x07 \bj!\r \x07  kj! \f)\0! ! \x07!\v A":\0\0 B\x83B\0R\r  j!\n@ Aj!\x7F@@@@@@@@ \n k"AL\r\0@@@@@@@@@@@@ -\0\0"-\0\xC0p\r -\0-\0\xC0p\r\r -\0-\0\xC0p\r -\0-\0\xC0p\r -\0-\0\xC0pE@ -\0-\0\xC0p\r -\0-\0\xC0p\r -\0\x07-\0\xC0p\r -\0\b-\0\xC0p\r -\0	-\0\xC0p\r -\0\n-\0\xC0p\r\x07 -\0\v-\0\xC0p\r\b -\0\f-\0\xC0p\r	 -\0\r-\0\xC0p\r\n -\0-\0\xC0p\r\v -\0-\0\xC0p\r\f  )\0\b7\0\b  )\0\x007\0\0 Aj! \n Aj"k"AL\r\r\f\v\v  (\0\x006\0\0 Aj! Aj!\f\v  -\0:\0  (\0\x006\0\0 Aj! Aj!\f\v  /\0;\0  (\0\x006\0\0 Aj! Aj!\f\v  (\06\0  (\0\x006\0\0 A\x07j! A\x07j!\f\v  )\0\x007\0\0 A\bj! A\bj!\f\v  -\0\b:\0\b  )\0\x007\0\0 A	j! A	j!\f\r\v  /\0\b;\0\b  )\0\x007\0\0 A\nj! A\nj!\f\f\v  (\0\x076\0\x07  )\0\x007\0\0 A\vj! A\vj!\f\v\v  (\0\b6\0\b  )\0\x007\0\0 A\fj! A\fj!\f\n\v  )\07\0  )\0\x007\0\0 A\rj! A\rj!\f	\v  )\07\0  )\0\x007\0\0 Aj! Aj!\f\b\v  )\0\x077\0\x07  )\0\x007\0\0 Aj! Aj!\f\x07\v AL\r@ -\0\0"-\0\xC0p\r\x07 -\0-\0\xC0p\r -\0-\0\xC0p\r -\0-\0\xC0p\r  (\0\x006\0\0 Aj! \n Aj"kAJ\r\0\v\f\v  :\0\0 Aj! Aj!\f\v  /\0\0;\0\0\f\v  -\0:\0  /\0\0;\0\0\f\vA\f\vA\f\v  \nO\rA\0!\x07 ! \n k"Aq"	@@ -\0\0"-\0\xC0p@ !\f\v  :\0\0 Aj! Aj! \x07Aj"\x07 	G\r\0\v\v AkAI\r  \nj k!@@@ -\0\0"-\0\xC0p@ !\f\v  :\0\0 -\0"-\0\xC0p\r  :\0 -\0"-\0\xC0p\r  :\0 -\0"-\0\xC0pE@  :\0 Aj! Aj" G\r\f\n\v\v Aj! Aj!\f\v Aj! Aj!\f\v Aj! Aj!\vA\0\v!@\x7F@@@@@@@@@@ \0\v@ Aj" \nK"	E@ -\0\0"\x07-\0\xC0p!\f\v  \nF\r \n k -\0\0"\x07-\0\xC0p"AvH\r\v@@ A\xFFq\n\0\x07\b	\n\v  \x07:\0\0 Aj!\f\f\v /\0\0"A\xE0\x81qA\xC0\x81G\r AqE\r  ;\0\0A!\f\n\v Aj! Aj\f\b\v@ 	E@ (\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0G\r\f\v /\0\0" -\0Atr"A\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0F\r\v  6\0\0A!\f\b\v Aj! Aj\f\v (\0\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r A\x87\xE0\0qE\r AqA\0 A\x83\xE0\0q\x1B\r  6\0\0 ! Aj\f\v  \x07At/\xC0v;\0\0 Aj! Aj\f\v A\xDC\xEA\xC1\x816\0\0  -\0\0At/\xC0r;\0 Aj! Aj\f\v /\0\0"A\xE0\x81qA\xC0\x81G\r\r AqE\r\r A\xDC\xEA;\0\0  AvAqA\xC0\xF2\0j/\0;\0  A\bvA?q AtrA\xFFqAt/\xC0r;\0 Aj! Aj\f\v /\0\0"\x07 -\0"AtrA\xF0\x81\x83qA\xE0\x81\x82G\r\f \x07A\x8F\xC0\0q"E\r\f A\x8D\xC0\0F\r\f A\xDC\xEA;\0\0  \x07AvA\xC0q" A?qrA\xFFqAt/\xC0r;\0  \x07A\ft rA\x07vA\xFEqA\xC0\xF2\0j/\0;\0 Aj! Aj\f\v (\0\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\v A\x87\xE0\0qE\r\v AqA\0 A\x83\xE0\0q\x1B\r\v A\xDC\xEA;\0 A\xDC\xEA;\0\0  AvAq/\xF8u;\0\b  AvA?q A\nv"A\xC0qrAt/\xC0r;\0\n  AtA\x80\x80\xF0\0q AtA\x80\xE0qrA\x80\x80k" A\x80qrA	vA\xFEq/\xC0r;\0  AvA\xB0jA\xFE\xFFq/\xC0r;\0 ! A\fj\v!A\0!\f\0\v\0\v\0\v@ AqAF@@  AjK@ ! !\f\vA! \b \bA!M\x1BAvA\x07jAxq" \bA\x7FsK\r\n   \bj"\b"E\r\n  \b \r k"kj! @    kj \xFC\n\0\0\v  \bj!\r   kj!\v B\b\x88\xA7"E@ A,:\0 A A\0 	A\x07F\x1B"A\xDD\0r:\0  A\xDB\0r:\0\0 ! ! Aj\f\v Ak \x006\0A!\x07 A\bk" At r6\0 A\xFB\0A\xDB\0 	A\x07F"\x1B:\0\0 Aj!  t!A\0!\v ! \f"\0(\b"!\f \r\f\x07\v@@@ 	Ak\0\v\v  AjM@A! \b \bA!M\x1BAvA\x07jAxq" \bA\x7FsK\r\v   \bj"\b"E\r\v  \b \r k"kj! @    kj \xFC\n\0\0\v  \bj!\r   kj! \f)\0! ! !\v B\xF4\xE4\xD5\xAB\xC6\xC5B\xE6\xC2\xB1\x9B\xD7\x8C\x8B B\x83B\0R"\x1B7\0\0  kAj\f\v  AjM@A! \b \bA!M\x1BAvA\x07jAxq" \bA\x7FsK\r\n   \bj"\b"E\r\n  \b \r k"kj! @    kj \xFC\n\0\0\v  \bj!\r   kj! ! !\v B\xEE\xEA\xB1\xE3\xC6\xC57\0\0 Aj\f\v B\b\x88\xA7"	A\xA6\xD5\xAA\xD5K\r\b \f(\b!\x07@   	Aj"jK@ ! !\f\v \bAv"   K\x1BA\x07jAxq" \bA\x7FsK\r	   \bj"\b"E\r	  \b \r k"kj! @    kj \xFC\n\0\0\v  \bj!\r   kj!\v 	@  \x07 	\xFC\n\0\0\v  	j"A,:\0\0 ! ! Aj\f\vA\0!\f\v  A(jM@A\xD1\0 \b \bA\xD1\0M\x1BAvA\x07jAxq" \bA\x7FsK\r\x07   \bj"\b"E\r\x07  \b \r k"kj! @    kj \xFC\n\0\0\v  \bj!\r   kj! \f)\0! ! !\v \f)\b!@ B\x83P@ A-:\0\0  B?\x88\xA7 \xA7Avq"j!\nB\0 }  \x1B"B\xFF\xC1\xD7/X@ \xA7!	 B\xE3\0X@ \n B\nT" 	Atr/\0\xA0j;\0\0 \n kAj!\f\v B\x8F\xCE\0X@ \n B\xE8\x07T" 	A\xFB(lAv"Atr/\0\xA0j;\0\0 \n k" A\x9C\x7Fl 	jAt/\xA0j;\0 Aj!\f\v B\xBF\x84=X@ \n B\xA0\x8DT" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \n k" A\xF0\xB1\x7Fl 	j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0 Aj!\f\v \n B\x80\xAD\xE2T" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \n k"\x07 A\xF0\xB1\x7Fl 	j"A\xFB(lAv"At/\xA0j;\0 \x07 A\x9C\x7Fl jAt/\xA0j;\0 \x07 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \x07A\bj!\f\v B\x80\xC2\xD7/\x80"B\x80\xBE\xA8\xD0~ |"\xA7! B\xFF\xFF\x83\xFE\xA6\xDE\xE1X@ \xA7!	\x7F B\xFF\xC7\xAF\xA0%X@ \n B\x80\x94\xEB\xDCT" 	Atr/\0\xA0j;\0\0 \n kAj\f\v B\xFF\x9F\x94\xA5\x8DX@ \n B\x80\xD0\xDB\xC3\xF4T" 	A\xFB(lAv"Atr/\0\xA0j;\0\0 \n k" A\x9C\x7Fl 	jAt/\xA0j;\0 Aj\f\v B\xFF\xFF\xE8\x83\xB1\xDEX@ \n B\x80\xC0\xCA\xF3\x84\xA3T" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \n k" A\xF0\xB1\x7Fl 	j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v \n B\x80\x80\x9A\xA6\xEA\xAF\xE3T" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \n k"\x07 A\xF0\xB1\x7Fl 	j"A\xFB(lAv"At/\xA0j;\0 \x07 A\x9C\x7Fl jAt/\xA0j;\0 \x07 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \x07A\bj\v" B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"\x07A\xFB(lAv"At/\xA0j;\0\0  \x07A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl \x07jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj!\f\v B\x80\xA0\x94\xA5\x8D\x80"\xA7!	 B\xF0\xB1\xFF\xFF~ |\xA7!\x07\x7F B\xFF\xFF\x8F\xBB\xBA\xD6\xAD\xF0\rX@ \n B\x80\x80\xA8\xEC\x85\xAF\xD1\xB1T" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \n k" A\xF0\xB1\x7Fl 	j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v \n B\x80\x80\xA0\xCF\xC8\xE0\xC8\xE3\x8A\x7FT" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \n k"\n A\xF0\xB1\x7Fl 	j"A\xFB(lAv"At/\xA0j;\0 \n A\x9C\x7Fl jAt/\xA0j;\0 \n A\x9C\x7Fl jAt/\xA0j;\0 \nA\bj\v" \x07A\xFB(lAv"At/\xA0j;\0\0  A\x9C\xFF\xFF\xFF\x07l \x07jAt/\xA0j;\0  B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"\x07A\xFB(lAv"At/\xA0j;\0  \x07A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0\b  A\x9C\x7Fl \x07jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0\n A\fj!\f\v\x7F@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\0X\r\0 B\x80\x80\x80\x80\x80\x80\x80\x80Z@   B<\x88\xA7\f\v B\x80\x80\x80\x80\x80\x80\x80\x80\bT\r\0  \f\v  \v"E\r\x07\v A,:\0\0 Aj\f\v Aj!@ AI\r\0A\0! Ak"\x07AvAjAq"	@@  )\0\b7\0\b  )\0\x007\0\0 Aj! Aj! Aj" 	G\r\0\v  	Atk!\v \x07A/M\r\0@  )\0\b7\0\b  )\0\x007\0\0  )\07\0  )\07\0  )\0(7\0(  )\0 7\0   )\x0007\x000  )\x0087\x008 A@k! A@k! A@j"AK\r\0\v\v@ AI\r\0A\0! Ak"\x07AvAjA\x07q"	@@  (\0\x006\0\0 Aj! Aj! Aj" 	G\r\0\v  	Atk!\v \x07AI\r\0@  (\0\x006\0\0  (\06\0  (\0\b6\0\b  (\0\f6\0\f  (\06\0  (\06\0  (\06\0  (\06\0 A j! A j! A k"AK\r\0\v\v E\r\0A\0! !\x07 A\x07q"	@@  -\0\0:\0\0 Aj! Aj! Aj" 	G\r\0\v Axq!\x07\v A\bI\r\0@  -\0\0:\0\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0\x07:\0\x07 A\bj! A\bj! \x07A\bk"\x07\r\0\v\v A":\0\0 A:A, A\x7Fs q\x1B:\0 Aj\v! Ak"\r\0\v@@ \0!\f A,:\0\0 Ak \vAtA\xDD\0j:\0\0  \rO\r Aj! (\0"Aq!\v (!\0 A\bj! AvAk"E\r\0\v\f\v\v\v A\0:\0\0\f\v \x07A\0\vA\b"E\r A\xFB\xFA;\0\0 Aj!\f\vA\b"E\r A\xDB\xBA;\0\0 Aj!\f\vA\b\b"E\r B\xEE\xEA\xB1\xE3\xC6\xC57\0\0 Aj!\f\vA\b\b"E\r B\xF4\xE4\xD5\xAB\xC6\xC5B\xE6\xC2\xB1\x9B\xD7\x8C\x8B B\x83B\0R"\0\x1B7\0\0  \0kAj!\f\vA*\b"E\r\0 \0)\b! B\x83P@ A-:\0\0  B?\x88\xA7 Avq"\0j!\vB\0 }  \0\x1B"B\xFF\xC1\xD7/X@ \xA7! B\xE3\0X@ \v B\nT"\0 Atr/\0\xA0j;\0\0 \v \0kAj!\f\v B\x8F\xCE\0X@ \v B\xE8\x07T"\0 A\xFB(lAv"Atr/\0\xA0j;\0\0 \v \0k"\0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj!\f\v B\xBF\x84=X@ \v B\xA0\x8DT" B\xB9\x9B~B \x88\xA7"\0Atr/\0\xA0j;\0\0 \v k" \0A\xF0\xB1\x7Fl j"A\xFB(lAv"\0At/\xA0j;\0  \0A\x9C\x7Fl jAt/\xA0j;\0 Aj!\f\v \v B\x80\xAD\xE2T"\0 B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \v \0k" A\xF0\xB1\x7Fl j"A\xFB(lAv"\0At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  \0A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj!\f\v B\x80\xC2\xD7/\x80"B\x80\xBE\xA8\xD0~ |"\xA7!\f B\xFF\xFF\x83\xFE\xA6\xDE\xE1X@ \xA7!\x7F B\xFF\xC7\xAF\xA0%X@ \v B\x80\x94\xEB\xDCT"\0 Atr/\0\xA0j;\0\0 \v \0kAj\f\v B\xFF\x9F\x94\xA5\x8DX@ \v B\x80\xD0\xDB\xC3\xF4T"\0 A\xFB(lAv"Atr/\0\xA0j;\0\0 \v \0k"\0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v B\xFF\xFF\xE8\x83\xB1\xDEX@ \v B\x80\xC0\xCA\xF3\x84\xA3T" B\xB9\x9B~B \x88\xA7"\0Atr/\0\xA0j;\0\0 \v k" \0A\xF0\xB1\x7Fl j"A\xFB(lAv"\0At/\xA0j;\0  \0A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v \v B\x80\x80\x9A\xA6\xEA\xAF\xE3T"\0 B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \v \0k" A\xF0\xB1\x7Fl j"A\xFB(lAv"\0At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  \0A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj\v" B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\0  A\xF0\xB1\x7Fl \fj"A\xFB(lAv"\0At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  \0A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj!\f\v B\x80\xA0\x94\xA5\x8D\x80"\xA7! B\xF0\xB1\xFF\xFF~ |\xA7!\x7F B\xFF\xFF\x8F\xBB\xBA\xD6\xAD\xF0\rX@ \v B\x80\x80\xA8\xEC\x85\xAF\xD1\xB1T" B\xB9\x9B~B \x88\xA7"\0Atr/\0\xA0j;\0\0 \v k" \0A\xF0\xB1\x7Fl j"A\xFB(lAv"\0At/\xA0j;\0  \0A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v \v B\x80\x80\xA0\xCF\xC8\xE0\xC8\xE3\x8A\x7FT"\0 B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \v \0k"\v A\xF0\xB1\x7Fl j"A\xFB(lAv"\0At/\xA0j;\0 \v A\x9C\x7Fl jAt/\xA0j;\0 \v \0A\x9C\x7Fl jAt/\xA0j;\0 \vA\bj\v" A\xFB(lAv"\0At/\xA0j;\0\0  \0A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0  B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0  A\xF0\xB1\x7Fl \fj"A\xFB(lAv"\0At/\xA0j;\0\b  A\x9C\x7Fl jAt/\xA0j;\0  \0A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0\n A\fj!\f\v@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\0X@  "E\r\f\v B\x80\x80\x80\x80\x80\x80\x80\x80Z@   B<\x88\xA7"E\r\f\v B\x80\x80\x80\x80\x80\x80\x80\x80\bZ@  "E\r\f\v  "E\r\0\f\v \x07A\0\v \v \0Aj!@ AI\r\0 Ak"AvAjAq"@@  )\0\b7\0\b  )\0\x007\0\0 Aj! Aj! Aj" G\r\0\v  Atk!\v A/M\r\0@  )\0\b7\0\b  )\0\x007\0\0  )\07\0  )\07\0  )\0(7\0(  )\0 7\0   )\x0007\x000  )\x0087\x008 A@k! A@k! A@j"AK\r\0\v\v@ AI\r\0 Ak"AvAjA\x07q"@A\0!@  (\0\x006\0\0 Aj! Aj! Aj" G\r\0\v  Atk!\v AI\r\0@  (\0\x006\0\0  (\06\0  (\0\b6\0\b  (\0\f6\0\f  (\06\0  (\06\0  (\06\0  (\06\0 A j! A j! A k"AK\r\0\v\v@ E\r\0 A\x07q"\x7FA\0!@  -\0\0:\0\0 Aj! Aj! Aj" G\r\0\v Axq \v! A\bI\r\0@  -\0\0:\0\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0\x07:\0\x07 A\bj! A\bj! A\bk"\r\0\v\v A":\0\0 Aj! \0!\v A\0:\0\0 \v \0\x07A\0\v\x9B\x7F@ A\xA9\xD5\xAA\xD5\0K\r\0 (\f \0(\b" AlAj"  I\x1B" (\0\0"E\r\0 \0(!  6  6\0 \0  j6 \0 Aj6\0 \0 6A! \0 \0(\f" \0(\b"\0At"   K\x1B" \0 K\x1B6\b\v \v\xC7\f\x7F~} \xBF\xB6"\xBC"AvA\xFFq"A\xFFF@A\0\v \0A-:\0\0 \0 Avj! C\0\0\0\0[@ A\xB0\xDC\xC06\0\0 Aj\v A\xFF\xFF\xFFq!\0 @ \0A\x80\x80\x80r!@ A\xFF\0kAK\r\0A\x96 k" hK\r\0\x7F  v"\0A\xE3\0M@  \0A\nI" \0Atr/\0\xA0j;\0\0  kAj\f\v \0A\x8F\xCE\0M@  \0A\xE8\x07I" \0A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\x9C\x7Fl \0jAt/\xA0j;\0 Aj\f\v \0\xAD! \0A\xBF\x84=M@  \0A\xA0\x8DI" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl \0j"\0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl \0jAt/\xA0j;\0 Aj\f\v  \0A\x80\xAD\xE2I" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl \0j"\0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l \0jAt/\xA0j;\0 A\bj\v"\0A\xAE\xE0\0;\0\0 \0Aj\v A\x96k"\x07A\x85\xA2l!\b\x7F@ \0E\r\0A\xB0\xC0\0 \bAu"Atk)\0"B\xFF\xFF\xFF\xFF\x83  A\x95\xDBrlAu \x07j"	Ajt\xAD"~B \x88 B \x88 ~|"B \x88\xA7"\fA\np!\x07 \xA7"\nA\x80\x80\x80\x80xF\r\0 \x07At \nAvr"\v A$ 	k\xAD\x88\xA7"	F\r\0 	 \vj"\rA\x81\x80\x80\x80jAI\r\0 \f \x07kA\n \x07 \nAvjA\0 	 \vI\x1B \rA\xFF\xFF\xFF\xFFyK\x1Bj\f\vA\xB0\xC0\0A\xDB\xFEwA\0 \0E AGq"\x07\x1B \bjAu"Atk)\0B|"B\xFF\xFF\xFF\xFF\x83" At"  A\x95\xDBrlAujA\x95k"t\xAD"~B \x88  B \x88"~|"B \x88\xA7!\0  Ar t\xAD"~B \x88  ~|"B\xFE\xFF\xFF\xFF\x83B\0R B \x88\xA7r Aq"\bk!   \x07rAk t\xAD"~B \x88  ~|"B\xFE\xFF\xFF\xFF\x83B\0R B \x88\xA7r \bj!@ B\x80\x80\x80\x80\x80T\r\0  \0A(n"A(l"\x07K  \x07A(jO"\x07s\r\0 A\nlA\nA\0 \x07\x1Bj\f\v B"\x88\xA7" B\xFE\xFF\xFF\xFF\x83B\0R \0r"\x07 \0A|q"\0Ar"\bK  \x07 \bFqr  \0AjO"  \0 Is\x1BAqj\v!\0 \0A\xFF\xC1\xD7/KA\bA\x07 \0A\xFF\xAC\xE2K\x1Bj j"AjAM@ B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0 B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0 B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0\b B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0\0 A kA\0 A\0L\x1Bj" \0A\x90\xCE\0n"\xADB\xDD\x9E\n~B\x88\xA7"\x07A)lA\fv"A0j:\0\0  A\0Gj"\n A\x9C\x7Fl \x07j"\bAt E \bA\nIq"r/\0\xA0j;\0\0 \n k" \x07A\x9C\x7Fl j"\x07At/\xA0j;\0\x7F A\xF0\xB1\x7Fl \0j"\0@  \0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl \0j"\0At/\xA0j;\0A\b \0-\0\xF0k -\0\xF0kAj \0\x1Bk\f\vA \x07-\0\xF0kA\0 \b-\0\xF0k \x07\x1Bjk\v!\0  A\0 A\0J"\x1Bj" j )\0\x007\0\0 A  AL\x1BjA.:\0\0  jAj" \0 j j"\0 \0 I\x1B\v  \0A\x90\xCE\0n"\xADB\xDD\x9E\n~B\x88\xA7"A)lA\fv"A0j:\0 AA \x1B"\bj A\x9C\x7Fl j"\x07At E \x07A\nIq"r/\0\xA0j;\0\0  \b k"\bj" A\x9C\x7Fl j"At/\xA0j;\0\x7F A\xF0\xB1\x7Fl \0j"\0@  \0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl \0j"\0At/\xA0j;\0A\b \0-\0\xF0k -\0\xF0kAj \0\x1Bk\f\vA -\0\xF0kA\0 \x07-\0\xF0k \x1Bjk\v!\0 -\0! A.:\0  :\0\0  \0 \bj"\0j \0AFk"\0A\xE5\xDA\0;\0\0 \0AA A\0L\x1Bj"\0 Ak" Au"s k"At A\nI"r/\0\xA0j;\0\0 \0 kAj\v\x7F@ \0E\r\0 \0At\xAD"B\x8B\xE7\x93\xD7~B \x88 B\x82\xFF\xF6\x9A\v~|"B \x88\xA7"\x07A\np! \xA7"A\x80\x80\x80\x80xF\r\0 At Avr"A\xF9\xB7\xD7\xD9jAI\r\0 A\xF8\xB7\xD7\xD9\0F\r\0 \x07 kA\n  AvjA\0 A\xF8\xB7\xD7\xD9\0K\x1B A\xF8\xB7\xD7\xD9jA\x80\x80\x80\x80I\x1Bj\f\v \0At"\xAD"B\x8C\xE7\x93\xD7~B \x88 B\x82\xFF\xF6\x9A\v~|"B \x88\xA7!\0 Ar\xAD"B\x8C\xE7\x93\xD7~B \x88 B\x82\xFF\xF6\x9A\v~|"B\xFE\xFF\xFF\xFF\x83B\0R B \x88\xA7r Aq"k! Ak\xAD"B\x8C\xE7\x93\xD7~B \x88 B\x82\xFF\xF6\x9A\v~|"B\xFE\xFF\xFF\xFF\x83B\0R B \x88\xA7r j!@ B\x80\x80\x80\x80\x80T\r\0  \0A(n"A(l"K  A(jO"s\r\0 A\nlA\nA\0 \x1Bj\f\v B"\x88\xA7" B\xFE\xFF\xFF\xFF\x83B\0R \0r" \0A\xFC\xFF\xFF\xFF\x07q"\0Ar"\x07K   \x07Fqr  \0AjO"  \0 Is\x1BAqj\v!\0 Aj!\x7F \0A\xE3\0M@  \0A\nI" \0Atr/\0\xA0j";\0\0  kAj\f\v \0A\x8F\xCE\0M@  \0A\xE8\x07I" \0A\xFB(lAv"Atr/\0\xA0j";\0\0  k" A\x9C\x7Fl \0jAt/\xA0j;\0 Aj\f\v \0\xAD! \0A\xBF\x84=M@  \0A\xA0\x8DI" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j";\0\0  k" A\xF0\xB1\x7Fl \0j"\0A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl \0jAt/\xA0j;\0 Aj\f\v  \0A\x80\xAD\xE2I" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"\x07Atr/\0\xA0j";\0\0  k" A\xF0\xB1\x7Fl \0j"\0A\xFB(lAv"At/\xA0j;\0  \x07A\x9C\x7Fl jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l \0jAt/\xA0j;\0 A\bj\v! A.:\0  :\0\0  Ak-\0\0A0Fk"\0 \0Ak-\0\0A0Fk!\0@ \0"Ak"\0-\0\0"A0F\r\0\v  A.Fk"\0A\xE5\xDA\0;\0\0 \0AA  k"A.J\x1Bj"\0 A/k" Au"s k"At A\nI"r/\0\xA0j;\0\0 \0 kAj\v\xA6$	\x7F\n~#\0A@j"	$\0\x7FA\0 B4\x88\xA7A\xFFq"A\xFFF\r\0 \0A-:\0\0 \0 B?\x88\xA7j!\0 B\x86"P@ \0A\xB0\xDC\xC06\0\0 \0Aj\f\v@ @ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83"\fB\x80\x80\x80\x80\x80\x80\x80\b\x84!\r@ A\xFF\x07kA4K\r\0A\xB3\b k" \rz\xA7K\r\0\x7F \r \xAD\x88"B\xFF\xC1\xD7/X@ \xA7! B\xE3\0X@ \0 B\nT" Atr/\0\xA0j;\0\0 \0 kAj\f\v B\x8F\xCE\0X@ \0 B\xE8\x07T" A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v B\xBF\x84=X@ \0 B\xA0\x8DT" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v \0 B\x80\xAD\xE2T" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0A\bj\f\v B\x80\xC2\xD7/\x80"\r\xA7! \rB\x80\xBE\xA8\xD0~ |"\f\xA7!\x7F B\xFF\xC7\xAF\xA0%X@ \0 B\x80\x94\xEB\xDCT" Atr/\0\xA0j;\0\0 \0 kAj\f\v B\xFF\x9F\x94\xA5\x8DX@ \0 B\x80\xD0\xDB\xC3\xF4T" A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v B\xFF\xFF\xE8\x83\xB1\xDEX@ \0 B\x80\xC0\xCA\xF3\x84\xA3T" \rB\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v \0 B\x80\x80\x9A\xA6\xEA\xAF\xE3T" \rB\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0A\bj\v"\0 \fB\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\0 \0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0A\bj\v"\0A\xAE\xE0\0;\0\0 \0Aj\f\v A\xB3\bk! B\x9F\xBD\x97\xEE\x9A\xB9\x8D\xCB\x88\x7FX@ 	AjA\xB8\xC0\0 A\x85\xA2lA\xDB\xFEwA\0 \fP AGq"\x1BjAu"At"k)\0 \r  A\x95\xDBrlAujA\xB2\bk\xAD\x86"\rAAA\xB0\xC0\0 k)\0"\rB\xFF\xFF\xFF\xFF\x83"\f B\xFF\xFF\xFF\xFF\x83"~"B \x88 \rB \x88"\r ~|"B \x88 \r B \x88"~|  \f~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\xFF\xFF\xFF\xFF\x83 B \x86\x84" 	)|"\r T\xAD| \rB\xD5\xAA\xD5\xAA\xD5\xAA\xD5\xAA\xD5\0B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7F \x1BZ\xAD"\r|"B\xFF\xFF\x83\xFE\xA6\xDE\xE1V\x1B!@ A~J\r\0A\0  j"k" J@ \0A\xB0\xDC\xC06\0\0 \0Aj\f\v A\0N\r\0 	  \r}"\r Al"5\xF0l\x88 )\xE8l\r 	)\b 5\xF4l\x88" \r  )\xE0l"\f~} \fB\x88Z\xAD|!A\0!AA \rB\xFF\xFF\x83\xFE\xA6\xDE\xE1V\x1B j"A\0N\x7F  Al)\xE0lZA\0\v j"A\0L\rA\0 k!\v \0B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0 \0B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0 \0B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0\b \0B\xB0\xE0\xC0\x81\x83\x86\x8C\x9807\0\0 \0A  j"kA\0 A\0L\x1Bj!\x7F B\x80\x80\x9A\xA6\xEA\xAF\xE3Z@  B\x80\x80\x84\xFE\xA6\xDE\xE1\x80"\r\xA7A0j:\0\0  B\xFF\xFF\x83\xFE\xA6\xDE\xE1Vj"  B\x80\xC2\xD7/\x80"B\x80\xBE\xA8\xD0~|"\fB\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"\x07At/\xA0j;\0\b  \rB\x80\xBE\xA8\xD0~ |"B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"\bAt/\xA0j;\0\0  \f\xA7 A\xF0\xB1\x7Flj"\nA\xFB(lAv"\vAt/\xA0j;\0\f  \x07A\x9C\x7Fl jAt/\xA0j;\0\n  \xA7 A\xF0\xB1\x7Flj"A\xFB(lAv"\x07At/\xA0j;\0  \bA\x9C\x7Fl jAt/\xA0j;\0  \vA\x9C\xFF\xFF\xFF\x07l \njAt/\xA0j;\0  \x07A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 Aj\f\v B\x80\xC2\xD7/Z@ B\x80\xC2\xD7/\x80"\r\xA7! \rB\x80\xBE\xA8\xD0~ |"\f\xA7!\x07\x7F B\xFF\xC7\xAF\xA0%X@  B\x80\x94\xEB\xDCT" Atr/\0\xA0j;\0\0  kAj\f\v B\xFF\x9F\x94\xA5\x8DX@  B\x80\xD0\xDB\xC3\xF4T" A\xFB(lAv"\bAtr/\0\xA0j;\0\0  k" \bA\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v B\xFF\xFF\xE8\x83\xB1\xDEX@  B\x80\xC0\xCA\xF3\x84\xA3T" \rB\xB9\x9B~B \x88\xA7"\bAtr/\0\xA0j;\0\0  k" \bA\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v  \rB\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"\bAt/\0\xA1j;\0\0  A\xF0\xB1\x7Fl j"A\xFB(lAv"\nAt/\xA0j;\0  \bA\x9C\x7Fl jAt/\xA0j;\0  \nA\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\x07j\v" \fB\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\0  A\xF0\xB1\x7Fl \x07j"\x07A\xFB(lAv"\bAt/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  \bA\x9C\xFF\xFF\xFF\x07l \x07jAt/\xA0j;\0 A\bj\f\v \xA7! B\xE3\0X@  B\nT" Atr/\0\xA0j;\0\0  kAj\f\v B\x8F\xCE\0X@  B\xE8\x07T" A\xFB(lAv"\x07Atr/\0\xA0j;\0\0  k" \x07A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v B\xBF\x84=X@  B\xA0\x8DT" B\xB9\x9B~B \x88\xA7"\x07Atr/\0\xA0j;\0\0  k" \x07A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v  B\x80\xAD\xE2T"\x07 B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"\bAtr/\0\xA0j;\0\0  \x07k" A\xF0\xB1\x7Fl j"A\xFB(lAv"\x07At/\xA0j;\0  \bA\x9C\x7Fl jAt/\xA0j;\0  \x07A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj\v! \0  Au"s kj" )\0\b7\0	  )\0\x007\0 \0A  AL\x1Bj"\0A.:\0\0 \0Aj"\0  Avj" \0 K\x1B"\0 \0Ak-\0\0A0Fk"\0 \0Ak-\0\0A0Fk!\0@ \0"Ak"\0-\0\0"A0F\r\0\v  A.Fj\f\v A\x85\xA2l! \0~@ \fP"\r\0 	A0jA\xB8\xC0\0 Au"At"\x07k)\0 \r A\x95\xDBrlAu j"Aj\xAD\x86"\f\rA\xB0\xC0\0 \x07k)\0"B\xFF\xFF\xFF\xFF\x83" \fB\xFF\xFF\xFF\xFF\x83"~"B \x88  B \x88"~|"B \x88  \fB \x88"\f~| \f ~ B\xFF\xFF\xFF\xFF\x83|"\fB \x88| B\xFF\xFF\xFF\xFF\x83 \fB \x86\x84" 	)8|"\f T\xAD|"B\n\x82! \fB\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FQ\r\0 A k\xAD\x88" B<\x86 \fB\x88\x84"Q\r\0  |"B\x81\x80\x80\x80\x80\x80\x80\x80\xE0\0|BT\r\0  }B\n  \fB?\x88|B\0  V\x1B B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x9F\x7FV\x1B|\f\v 	A jA\xB8\xC0\0A\xDB\xFEwA\0  AGq"\x1B jAu"At"k)\0B|" \rB\x86" \xAD\x84B}  A\x95\xDBrlAujA\xB2\bk\xAD"\x86"\f\r B\x83"A\xB0\xC0\0 k)\0"\rB\xFF\xFF\xFF\xFF\x83" \fB\xFF\xFF\xFF\xFF\x83"~"B \x88 \rB \x88"\r ~|"B \x88 \r \fB \x88"\f~|  \f~ B\xFF\xFF\xFF\xFF\x83|"\fB \x88| B\xFF\xFF\xFF\xFF\x83 \fB \x86\x84"\f 	)(|" \fT\xAD| BV\xAD\x84|!  B\x84 \x86"B\xFE\xFF\xFF\xFF\x83"\f~"B \x88 \f \r~|"B \x88 \r B \x88"~|  ~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\xFE\xFF\xFF\xFF\x83 B \x86\x84" B \x88" \f~ \f B\xFF\xFF\xFF\xFF\x83"\f~B \x88|"B \x88  ~|| \f ~ B\xFF\xFF\xFF\xFF\x83|B \x88|" T\xAD| BV\xAD\x84 }!@   \x86"B\xFC\xFF\xFF\xFF\x83"~"B \x88 \r ~|"B \x88 \r B \x88"~|  ~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\xFC\xFF\xFF\xFF\x83 B \x86\x84"  ~  ~ \f ~B \x88|"\rB \x88|| \f ~ \rB\xFF\xFF\xFF\xFF\x83|B \x88|"\r T\xAD|"B(T\r\0  B(\x80"\fB(~"V  B(|Z"s\r\0 \fB\n~B\nB\0 \x1B|\f\v B\x88"\f  \rBV\xAD\x84"\r B|\x83"B\x84"V \f\xA7 \r Qqr  B|Z"   Ts\x1B\xADB\x83|\v"B\x80\xC2\xD7/\x80"\r\xA7"\nA\x90\xCE\0n"\xADB\xDD\x9E\n~B\x88\xA7"\x07A)lA\fv"A0j:\0 \0AA \x1B"j" \x07A\x9C\x7Fl j"\bAt/\xA0j;\0  A\x9C\x7Fl \x07j"\x07At/\xA0j;\0\0 A\xF0\xB1\x7Fl \nj!\x7F \rB\x80\xBE\xA8\xD0~ |"\r\xA7"\n@  A\xFB(lAv"At/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0  \rB\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\b  A\x9C\x7Fl j"\x07At/\xA0j;\0\n A\xF0\xB1\x7Fl \nj"@  A\xFB(lAv"At/\xA0j;\0\f  A\x9C\x7Fl j"At/\xA0j;\0 Ar -\0\xF0k -\0\xF0kAj \x1Bk\f\v A\fr \x07-\0\xF0k -\0\xF0kAj \x07\x1Bk\f\v @  A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl j"At/\xA0j;\0 A\br -\0\xF0k -\0\xF0kAj \x1Bk\f\vAA \x1B \b-\0\xF0kA\0 \x07-\0\xF0k \b\x1Bjk\v! \0-\0! \0A.:\0 \0 :\0\0 \0 j AFk"\0A\xE5\xDA\0;\0\0 \0AAAA B\xFF\xFF\x83\xFE\xA6\xDE\xE1V\x1B j"A\0N\x1Bj!\0  Au"s k"A\xE3\0M@ \0 A\nI" Atr/\0\xA0j;\0\0 \0 kAj\f\v \0 A\x90lAv"A0j:\0\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0Aj\f\v \0A\xB0\xDC\xC06\0\0 \0Aj\f\v \0A\xB0\xDC\xC06\0\0 \0Aj\v 	A@k$\0\v\xA4\x7F@ (\0E\r\0 A\0! !@ E\r\0 E\r\0    (\0\0!\v \x07 \x07 E\r\0  "@ \0 (\0\f B\x007 (!\0 (\f! B\x007\f ("@ \0  \0\0\v \0  \0\0 \x07\v \x07\v \0 \f\v\x87\x7F A\x80O@ @ \0  \xFC\n\0\0\v\v \0 j!@ \0 sAqE@@ \0AqE@ \0!\f\v E@ \0!\f\v \0!@  -\0\0:\0\0 Aj! Aj"AqE\r  I\r\0\v\v A|q!\0@ A\xC0\0I\r\0  \0A@j"K\r\0@  (\x006\0  (6  (\b6\b  (\f6\f  (6  (6  (6  (6  ( 6   ($6$  ((6(  (,6,  (060  (464  (868  (<6< A@k! A@k" M\r\0\v\v \0 M\r@  (\x006\0 Aj! Aj" \0I\r\0\v\f\v AI@ \0!\f\v AI@ \0!\f\v Ak! \0!@  -\0\0:\0\0  -\0:\0  -\0:\0  -\0:\0 Aj! Aj" M\r\0\v\v  I@@  -\0\0:\0\0 Aj! Aj" G\r\0\v\v\v\xAD\xED\f~\x7F|#\0A\xF0\bk"$\0@ AkAyK\r\0 Aj\b"!E\r\0 @ ! \0 \xFC\n\0\0\v  !j"A\x006\0\0@ !"\0-\0\0"A\xDFqA\xDB\0G@ \0!@ "\0Aj! \0-\0\0"-\0\x80Aq\r\0\v \0 O\r\v@@@@@@\x7F@@@@ A\xDFqA\xDB\0F@ \0Aj!@ \0-\0-\0\x80AqE\r\0 \0-\0-\0\x80AqE\r\0A\xF9\xFF\xFF\xFF\0  \0kAv" A\xF9\xFF\xFF\xFF\0O\x1BAj"\x1BAt"\b"E@A\0!\f\f\v \0Aj! A j!  jA k! \0-\0\0A\xFB\0F@ A\x006( B\x077    -\0\0A\nF\x1B!\0\f\v A\x006( B7    -\0\0A\nF\x1B!\f\vA\xF9\xFF\xFF\xFF\0  \0kAn" A\xF9\xFF\xFF\xFF\0O\x1BAj"At\b"E@A\0!\f\n\v A j!  AtjA k!  \0-\0\0A\xFB\0F@ A\x006( B\x077 \f\v A\x006( B7 \f\v A\xF0\r)\x007P A\xE8\r)\x007H \0!A\0!#\0A\xB0\bk"$\0@@@@ A\xCF\f\x7F@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ (T"A0 (H\0"@ A j!\x1B \0-\0\0"-\0\x80Aq@ A\x006\xAC\b \0 A-Fj"-\0\0"\0A1kA\xFFqA	O@ \0A0G@ !A\x9D	\f"\v Aj!\0 -\0"-\0\x80AqE@ B\x007( B\fB A-F\x1B7 \f$\v@ A.F@ Aj! -\0"A0kA\xFFqA	K@ !A\xB7\b\f$\v A\xFFqA0F@@ "Aj! -\0"A0F\r\0\v A0kA\xFFqA	K\r\v Ak! \xADB\xFF\x83B0}!\f	\v \0! A0kA\xFFqA\nO\r\0 !A\xA7\f\f"\v@ A\xDFqA\xC5\0G@ !\0\f\vA\x80	 AA -\0-\0\x80Aq\x1Bj"-\0\0A0kA\xFFqA	K\r" !\0@ \0"Aj!\0 -\0A0kA\xFFqA\nI\r\0\v\v B7  B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7(\f#\v \0\xADB\xFF\x83"B0}!@@@@@@@@@@@@@@@@@@ -\0"\xADB0}"B	X@  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0\x07"\xADB0}"B	V\r  B\n~|! -\0\b"\xADB0}"B	V\r\x07  B\n~|! -\0	"\xADB0}"B	V\r\b  B\n~|! -\0\n"\xADB0}"B	V\r	  B\n~|! -\0\v"\xADB0}"B	V\r\n  B\n~|! -\0\f"\xADB0}"B	V\r\v  B\n~|! -\0\r"\xADB0}"B	V\r\f  B\n~|! -\0"\xADB0}"B	V\r\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r Aj!\0  B\n~|! -\0"-\0\x80Aq\r@ A-G\r\0 B\x81\x80\x80\x80\x80\x80\x80\x80\x80\x7FT\r\0 B7   \xBA\x9A9(\f6\v B\0 }  A-F"\x1B7( B\fB \x1B7 \f5\v Aj!\0 -\0\x80AqE@ B0 }  A-F"\x1B7( B\fB \x1B7 \f5\v A.F\r\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f4\v A.G\r\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f3\v A.G\r\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f2\v A.G\r\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f1\v A.G\r\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f0\v A.G\r\f\v A\x07j!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f/\v A.G\r\f\v A\bj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f.\v A.G\r\f\v A	j!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f-\v A.G\r\f\v A\nj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f,\v A.G\r\f\v A\vj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f+\v A.G\r\r\f\v A\fj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f*\v A.G\r\f\f\v A\rj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f)\v A.G\r\v\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f(\v A.G\r\n\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f\'\v A.G\r	\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f&\v A.G\r\b\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f%\v A.G\r\x07\f\v Aj!\0 -\0\x80AqE@ B\0 }  A-F"\x1B7( B\fB \x1B7 \f$\v A.G\r\f\v@ A0kA\xFFqA	K\r\0 -\0-\0\x80Aq\r\0 B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCZ@ B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCR\r A5K\r\v Aj!\0 \xAD B\n~|B0}! A-F@ B7   \xBA\x9A9(\f$\v  7( B7 \f#\v A\xDFqA\xC5\0F@B\0! \0!A\0!\f\vA\0! A.G@ \0!\f\v Aj! -\0"A0kA\xFFqA	K\r \0!\f\x1B\v@@ A\xE6\0k\0\v A"G\r\0 Aj"!\0@@@@\x7F \0 \0-\0\0"-\0\x80AqE\r\0 \0Aj \0-\0"-\0\x80AqE\r\0 \0Aj \0-\0"-\0\x80AqE\r\0 \0Aj \0-\0"-\0\x80AqE\r\0 \0Aj \0-\0"-\0\x80AqE\r\0 \0Aj \0-\0"-\0\x80AqE\r\0 \0Aj \0-\0"-\0\x80AqE\r\0 \0A\x07j \0-\0\x07"-\0\x80AqE\r\0 \0A\bj \0-\0\b"-\0\x80AqE\r\0 \0A	j \0-\0	"-\0\x80AqE\r\0 \0A\nj \0-\0\n"-\0\x80AqE\r\0 \0A\vj \0-\0\v"-\0\x80AqE\r\0 \0A\fj \0-\0\f"-\0\x80AqE\r\0 \0A\rj \0-\0\r"-\0\x80AqE\r\0 \0Aj \0-\0"-\0\x80AqE\r\0 \0-\0"-\0\x80Aq\r \0Aj\v! A"F@  6(   k\xACB\b\x86B\r\x847  A\0:\0\0 Aj!\0\f\'\v \xC0A\0H\r !@\x7F@@@ A\xFFq"\0A\xDC\0G@ \0A"F\rA\xBA	!\f	\vA\x98\v!@@@@@@@@@ -\0A"kT\0\x07\b\v A":\0\0 Aj!\0\f\n\v A\xDC\0:\0\0 Aj!\0\f	\v A/:\0\0 Aj!\0\f\b\v A\b:\0\0 Aj!\0\f\x07\v A\f:\0\0 Aj!\0\f\v A\n:\0\0 Aj!\0\f\v A\r:\0\0 Aj!\0\f\v A	:\0\0 Aj!\0\f\v -\0-\0\x80 -\0-\0\x80A\btr" -\0-\0\x80 -\0-\0\x80A\btr"rA\xF0\xE1q\r\b Aj!\0  Atr"A\x80\xF0qA\x80\xB0G@ A\xFF\xFFq"A\x80O@  A?qA\x80r:\0  AvA?qA\x80r:\0  A\x80\xE0qA\fvA\xE0r:\0\0 Aj\f\v A\x80I\r  A?qA\x80r:\0  AvA\xC0r:\0\0 Aj\f\v A\x80\xB8qA\x80\xB0G@A\xDE\n!\f	\v \0/\0\0A\xDC\xEAG@A\xA3\n!\f	\v -\0\v-\0\x80 -\0	-\0\x80A\btr"\0 -\0\n-\0\x80 -\0\b-\0\x80A\btr"rA\xF0\xE1q@A\xFF\n!\f	\v \0 Atr"\0A\x80\xF8qA\x80\xB8G@A\xBE\n!\f	\v  \0A?qA\x80r:\0  \0A\xFF\xBFq A\ntA\x80\xF8\xBF\x1Bqj"\0A\x80\xB8\xFFk"AvA\xF0r:\0\0  \0AvAjA?qA\x80r:\0  A\fvA?qA\x80r:\0 A\fj!\0 Aj\f\v  6(   k\xACB\b\x86B\x847  A\0:\0\0 Aj!\0\f*\v  :\0\0\v Aj\v!@@ \0-\0\0"-\0\x80AqE@ \0!\f\v\x7F@@@@@@@@@@@@@ \0-\0-\0\x80Aq@ \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0\x07-\0\x80AqE\r \0-\0\b-\0\x80AqE\r\x07 \0-\0	-\0\x80AqE\r\b \0-\0\n-\0\x80AqE\r	 \0-\0\v-\0\x80AqE\r\n \0-\0\f-\0\x80AqE\r\v \0-\0\r-\0\x80AqE\r\f \0-\0-\0\x80AqE\r\r \0-\0 \0)\0\0!  \0)\0\b7\0\b  7\0\0-\0\x80AqE@A! \0Aj\f\v \0Aj!\0 Aj!\f\v  \0/\0\0;\0\0A! \0Aj\f\r\v  \0/\0\0;\0\0A! \0Aj\f\f\v  \0(\0\x006\0\0A! \0Aj\f\v\v  \0(\0\x006\0\0A! \0Aj\f\n\v  \0(\0\x006\0\0  \0/\0;\0A! \0Aj\f	\v  \0(\0\x006\0\0  \0/\0;\0A! \0Aj\f\b\v  \0)\0\x007\0\0A\x07! \0A\x07j\f\x07\v  \0)\0\x007\0\0A\b! \0A\bj\f\v  \0)\0\x007\0\0  \0/\0\b;\0\bA	! \0A	j\f\v  \0)\0\x007\0\0  \0/\0\b;\0\bA\n! \0A\nj\f\v  \0)\0\x007\0\0  \0(\0\b6\0\bA\v! \0A\vj\f\v  \0)\0\x007\0\0  \0(\0\b6\0\bA\f! \0A\fj\f\v  \0)\0\x007\0\0  \0(\0\b6\0\b  \0/\0\f;\0\fA\r! \0A\rj\f\v  \0)\0\x007\0\0  \0(\0\b6\0\b  \0/\0\f;\0\fA! \0Aj\v!  j! -\0\0!\v \xC0A\0N\r@ ""\0(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"\0E@ !\0\f\v \0A\x8D\xC0\0F@ !\0\f\v  6\0\0 Aj! (\0! Aj"\0! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 \0! AqE\r\0@  ;\0\0 Aj!\0 Aj! (\0"A\xE0\x81qA\xC0\x81G\r \0! Aq\r\0\v\v@ A\x87\xE0\0qE\r\0 A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0@ AqE@ \0!\f\v \0! A\x83\xE0\0q\r\v@  6\0\0 Aj!\0 Aj! (\0"A\x87\xE0\0qE\r A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r \0! AqE\r\0 A\x83\xE0\0qE\r\0\v\v \0 G\r\0\v\vA\xE1	! \0!\f\v \0Aj!\0\f\v@ ""\0(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"\0E@ !\0\f\v \0A\x8D\xC0\0F@ !\0\f\v (\0! Aj"\0! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 \0! AqE\r\0@ Aj!\0 (\0"A\xE0\x81qA\xC0\x81G\r \0! Aq\r\0\v\v@ A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0 \0! A\x87\xE0\0qE\r\0@@ AqE\r\0 A\x83\xE0\0qE\r\0 !\0\f\v Aj!\0 (\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r \0! A\x87\xE0\0q\r\0\v\v \0 G\r\0\vA\x82\n! \0!\v A\xCF\f   A\n"\0\x1B6\xE4 AA\n \0\x1B6\xE0    \0\x1B !k6\xE8 (T  (P\0\0\f#\v A\xCF\fA\xC4\v  A"\0\x1B6\xE4 AA \0\x1B6\xE0    \0\x1B !k6\xE8   (P\0\0\f"\v  A@ A\xCF\f6\xE4 A6\xE0   !k6\xE8\f"\v A\x80\b6\xE4 A6\xE0   !k6\xE8\f!\v (\0\0A\xEE\xEA\xB1\xE3F@ B7  Aj!\0\f \v A\xCF\fA\x83\r  A\v"\0\x1B6\xE4 AA\v \0\x1B6\xE0    \0\x1B !k6\xE8   (P\0\0\f \v (\0A\xE1\xD8\xCD\xABF@ B7  Aj!\0\f\v A\xCF\fA\xC5\r  A\v"\0\x1B6\xE4 AA\v \0\x1B6\xE0    \0\x1B !k6\xE8   (P\0\0\f\v (\0\0A\xF4\xE4\xD5\xABF@ B\v7  Aj!\0\f\v A\xCF\fA\xA4\r  A\v"\0\x1B6\xE4 AA\v \0\x1B6\xE0    \0\x1B !k6\xE8   (P\0\0\f\vB\0! \0"!\f\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0\x07"\xADB\xFF\x83B0}"B	V@ A\x07j! \0!\f\r\v  B\n~|!\v -\0\b"\xADB\xFF\x83B0}"B	V@ A\bj! \0!\f\f\v  B\n~|!\v -\0	"\xADB\xFF\x83B0}"B	V@ A	j! \0!\f\v\v  B\n~|!\v -\0\n"\xADB\xFF\x83B0}"B	V@ A\nj! \0!\f\n\v  B\n~|!\v -\0\v"\xADB\xFF\x83B0}"B	V@ A\vj! \0!\f	\v  B\n~|!\v -\0\f"\xADB\xFF\x83B0}"B	V@ A\fj! \0!\f\b\v  B\n~|!\v -\0\r"\xADB\xFF\x83B0}"B	V@ A\rj! \0!\f\x07\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v -\0"\xADB\xFF\x83B0}"B	V@ Aj! \0!\f\v  B\n~|!\v \0! -\0"\xADB\xFF\x83B0}"B	V@ Aj!\f\v Aj!  B\n~|! -\0"A0kA\xFFqA\nI\r\v Aj G\r\v !A\xB7\b\f\vB  k"\0\xAC}! A\xDFqA\xC5\0F@A\0! !\0\f\vA\0! \0A\xD9H@ !\0\f\v B7  B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7( !\0\f\x07\v !@ "\0Aj! \0-\0"A0kA\xFFqA\nI\r\0\v@ @ !\0\f\v@ A\xFFqA.G@ !\0\f\v \0Aj! \0-\0A0kA\xFFqA	K@ !A\xB7\b\f\x07\v@ "\0Aj! \0-\0\0"A0kA\xFFqA\nI\r\0\v\v !\v  A\xFFqA4K\xAD|!  k\xAC  I\xAD|! \0!@@@ Ak"-\0\0A.k\0\0\v  K\r\v\vA\0   I"\x1B!A\0 \0 \x1B! A\xDFqA\xC5\0G\r\v \0Aj \0-\0"-\0\x80Aqj"-\0\0"\0A0k"A\xFFqA	K@ !A\x80	\f\v@ \0A0F@@ "\0Aj! \0-\0"A0F\r\0\vB\0! !\0 A0k"A\xFFqA	K\r\vB\0! !\0@ B\n~ \xADB\xFF\x83|! \0"Aj!\0 -\0A0k"A\xFFqA\nI\r\0\v\v \0 kAN@ A-G\r B7  B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7(\f\vB\0 }  A-F\x1B |!\v B\xA8}W@ B7  B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7(\f\v B\xB4U\r\v  \xA7"6\xAC\b@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFFV\r\0 AjA,K\r\0 \xBA!%| A\0H@ %A\x80 Atk+\0\xA3\f\v At+\x80 %\xA2\v!% B7   %\x9A % A-F\x1B9(\f\v P@ B7  B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7(\f\v A\xEA\xA4\rlA\x80\x80\xFCkAu!@ E A\xB2jA\xD2IqE@  y"\x07\x86"B\xFF\xFF\xFF\xFF\x83! B \x88!\b At"A\xB8\xC0\0j)\0! A\xB0\xC0\0j)\0! \x07\xA7!\f\v y"\x07\xA7! At"A\xB0\xC0\0j)\0"B\xFF\xFF\xFF\xFF\x83"  \x07\x86"	B\xFF\xFF\xFF\xFF\x83"~"\nB \x88 B \x88" ~|"\vB \x88  	B \x88"\b~|  \b~ \vB\xFF\xFF\xFF\xFF\x83|"\vB \x88|"B\xFF\x83B}B\xFEZ@  A\xB8\xC0\0j)\0" 	\r \nB\xFF\xFF\xFF\xFF\x83 \vB \x86\x84"	 )\b|"\nB}B}V\r  	 \nV\xAD|!\v B7    k B\0Y"kA\xC1\0A\xC0\0  \xAD\x86"B\x80\b\x83 |"B\x80\bT\x1BjA\xBE\bj\xADB4\x86 B\v\x88B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83\x84B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B\x847(\f\vB\0!B\bB	BB\0 \x1B \x07\x86"\x07P\x1B \x07| B?\x88 |"\x07B\xFF\xFF\xFF\xFF\x83" ~B \x88  \x07B \x88"\x07~|"B \x88 \x07 \b~|  \b~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\x88B\x83|"y"\x07\x86!\b  \x07\x86!A\xC0\0!\x7FA\v   \x07\xA7jkA@k"A\xC2wJ\r\0@ A\x8FwI\r\0A\xCEw k! A\x91wM\r\0 \f\v A<k" j!  \xAD"\x07\x88! \b \x07\x88B	|!\bA<\v!@  \xAD"\x07\x88 B\x7F \x07\x86B\x7F\x85\x83B\x86"\x07B\b Ak\xAD\x86" \b|Z"\xAD|"P\r\0  j y"\xA7k"A\xC0\x07J\r  \x86B\v\x88! A\xC3wN@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83 A\xBE\bj\xADB4\x86\x84!\f\v A\x8FwI\r\0 A\xC3w k\xAD\x88!\v \x07  \b}X\r \r A\xA0j  A\xAC\bj      B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83B\x80\x80\x80\x80\x80\x80\x80\b\x84 B\x80\x80\x80\x80\x80\x80\x80\bT"\x1BB\x86B\x847 A\xCDw B4\x88\xA7A\xB4\bk \x1B! A j!@ (\xAC\b"A\0N@ (\xA0! AO@ A\xA8j!@ !A\0!@@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\vB\0!  M\r\0@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"\bB\x80\x80\xA0\xCF\b~"\x07B \x88 \bB\x84\xC6\x9C\xD6\b~|"\bB\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 \x07B\x80\x80\xE0\xFF\x83\x84"\x07|"7\0  \x07T\xAD B\x84\xC6\x9C\xD6\b~ \bB \x88| B \x88||! Aj" G\r\0\v P\r\0  Atj 7\0 Aj!\v Ak! A%J\r\0\v\v  6\xA0A! E\r AtA\x80\xE9\0j)\0! A\xA8j!A\0!@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\v  M\r B\xFF\xFF\xFF\xFF\x83! B \x88!\bB\0!@  Atj"  )\0"\x07B\xFF\xFF\xFF\xFF\x83" ~"B \x88  \b~|"B\xFF\xFF\xFF\xFF\x83 \x07B \x88"\x07 ~|"	B \x86 B\xFF\xFF\xFF\xFF\x83\x84"|"7\0  T\xAD \x07 \b~ B \x88| 	B \x88||! Aj" G\r\0\vA! P\r  Aj6\xA0  Atj 7\0\f\vA\0 k!A!@ AnI@@ !A\0!@@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\vB\0!  M\r\0@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"\bB\x80\x80\xA0\xCF\b~"\x07B \x88 \bB\x84\xC6\x9C\xD6\b~|"\bB\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 \x07B\x80\x80\xE0\xFF\x83\x84"\x07|"7\0  \x07T\xAD B\x84\xC6\x9C\xD6\b~ \bB \x88| B \x88||! Aj" G\r\0\v P\r\0  Atj 7\0 Aj!\v Ak! A%J\r\0\v  6 E\r \rA\0!\f\v A6\v AtA\x80\xE9\0j)\0!A\0!@  Atj)\0P@ Aj" G\r\f\v\v  M\r\0 B\xFF\xFF\xFF\xFF\x83! B \x88!\bB\0!@  Atj"  )\0"\x07B\xFF\xFF\xFF\xFF\x83" ~"B \x88  \b~|"B\xFF\xFF\xFF\xFF\x83 \x07B \x88"\x07 ~|"	B \x86 B\xFF\xFF\xFF\xFF\x83\x84"|"7\0  T\xAD \x07 \b~ B \x88| 	B \x88||! Aj" G\r\0\v P\r\0  Atj 7\0 Aj!\v@@@ A\0J@ Av! A?q"E@@ E\r\0 "Aq"@A\0!@ Aj Atj" Atj )\x007\0 Ak! Aj" G\r\0\v\v AI\r\0@ Aj Atj" At"j )\x007\0 A\bk" j )\x007\0 Ak" j )\x007\0 Ak" j )\x007\0 Ak"\r\0\v\v   j"6\f\v  Atj"B\x007\0 \xAD!@ E\r\0A\xC0\0 k\xAD! "Aq@  Atj Aj Atj)\0 \x887\0 Ak!\v AF\r\0 At" Ajj!@  At"j" j )\0 \x86 Aj j")\0"\b \x88\x847\0  j \b \x86 A\bk)\0 \x88\x847\0 Ak"\r\0\v\v  At"j )  \x867\0  j  j)\0B\0Rj! \r\f\vA\0 k"Av! (\xA0! A?q"E@@ E\r\0 "Aq"@A\0!@ A\xA0j Atj" Atj )\x007\0 Ak! Aj" G\r\0\v\v AI\r\0@ A\xA0j Atj" At"j )\x007\0 A\bk" j )\x007\0 Ak" j )\x007\0 Ak" j )\x007\0 Ak"\r\0\v\v   j"6\xA0 E\r A\xA8j!\f\v A\xA8j" Atj"B\x007\0 \xAD!@ E\r\0A\xC0\0 k\xAD! "Aq@  Atj A\xA0j Atj)\0 \x887\0 Ak!\v AF\r\0 At" A\xA0jj!@  At"j" j )\0 \x86 A\xA0j j")\0"\b \x88\x847\0  j \b \x86 A\bk)\0 \x88\x847\0 Ak"\r\0\v\v  At"j )\xA8 \x867\0   j  j)\0B\0Rj"6\xA0 E\r\v At"E\r\0 A\0 \xFC\v\0\v (\xA0!\v~@@  K@A\x7F!\f\v  I@A!\f\v E\r@@A\x7FA  At" A\xA0jj)\0" Aj j)\0"V\x1B  T\x1B!  R\r\0 Ak"\r\f\v\v E\r\v A\0J\xAD\f\v B\x83\v |"B\x80\x80\x80\x80\x80\x80\x80\xF8\xFF\0R\r (T!\vA\xF6\v\v  A	"\0\x1B6\xE4 AA	 \0\x1B6\xE0    \0\x1B !k6\xE8   (P\0\0\f\v B7   B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B\x847(\v@ \0 I@@ \0"Aj!\0 -\0\0-\0\x80Aq\r\0\v  I\r !\0\v  \x1B6\0  )H7  )P7\f  !6 A6  \0 !k6\f\v A\xCF\fA\xD4\b  A"\0\x1B6\xE4 AA \0\x1B6\xE0    \0\x1B !k6\xE8 (T  (P\0\0\vA\0!\v A\xB0\bj$\0 "E\r\v\f\f\vA\0!\f\vA!\f\vA\0\f\vA\v!@\x7F E@ !A\0\f\v !A\v!@@@\x7F@@@@@@@@@@@@@@@@@@ E@ -\0\0!@ A\xFFq"\0A\xDB\0F@ ! ! !\f\v \0A\xFB\0F@ ! ! !\f\v@@@@@ \0-\0\x80"Aq@@   Aj"K@ !\f\v Av j"A\xFE\xFF\xFF\xFF\0K@ !\0\f$\v  At"\0"E@ !\0\f$\v   kj!   kj! \0 jA k! \v A\x006\xEC\b Aj!@@@@@@@@@@@@@@@@@@@@@@@  -\0\0"\x1BA-Fj"\0-\0\0"A1kA\xFFqA	O@ A0G\r! \0Aj! \0-\0"-\0\x80AqE@ B\x007\b B\fB \x1BA-F\x1B7\0 !\f2\v@ A.F@ \0Aj! \0-\0"A0kA\xFFqA	K@ !\0\f$\v A\xFFqA0F@@ "\0Aj! \0-\0"A0F\r\0\v A0kA\xFFqA	K\r\v Ak!\0 \xADB\xFF\x83B0}!\f\v ! A0kA\xFFqA\nI\r"\v A\xDFqA\xC5\0F@ AA -\0-\0\x80Aq\x1Bj"-\0\0A0kA\xFFqA	K@ !\0\f#\v@ "\0Aj! \0-\0A0kA\xFFqA\nI\r\0\v\v B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 \x1BA-F\x1B7\b\f1\v \xADB\xFF\x83"B0}!@@@@@@@@@@@@@@@@@@@ \0-\0"\xADB0}"\bB	X@ \b B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0\x07"\xADB0}"B	V\r  B\n~|! \0-\0\b"\xADB0}"B	V\r\x07  B\n~|! \0-\0	"\xADB0}"B	V\r\b  B\n~|! \0-\0\n"\xADB0}"B	V\r	  B\n~|! \0-\0\v"\xADB0}"B	V\r\n  B\n~|! \0-\0\f"\xADB0}"B	V\r\v  B\n~|! \0-\0\r"\xADB0}"B	V\r\f  B\n~|! \0-\0"\xADB0}"B	V\r\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r \0Aj!  B\n~|! \0-\0"-\0\x80Aq\r@ \x1BA-G\r\0 B\x81\x80\x80\x80\x80\x80\x80\x80\x80\x7FT\r\0 B7\0  \xBA\x9A9\b\fE\v B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0\fD\v \0Aj! -\0\x80Aq\r B0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\fC\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\fC\vA\0!B\0! "! A.F\r\f&\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\fB\vA\0!B\0! "! A.F\r\f%\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\fA\vA\0!B\0! "! A.F\r\f$\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f@\vA\0!B\0! "! A.F\r\f#\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f?\vA\0!B\0! "! A.F\r\f"\v \0A\x07j! -\0\x80AqE@ B\fB \x1BA-F"\0\x1B7\0 B\0 }  \0\x1B7\b !\f>\vA\0!B\0! "! A.F\r\f!\v \0A\bj! -\0\x80AqE@ B\fB \x1BA-F"\0\x1B7\0 B\0 }  \0\x1B7\b !\f=\vA\0!B\0! "! A.F\r\f \v \0A	j! -\0\x80AqE@ B\fB \x1BA-F"\0\x1B7\0 B\0 }  \0\x1B7\b !\f<\vA\0!B\0! "! A.F\r\f\v \0A\nj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f;\vA\0!B\0! "! A.F\r\f\v \0A\vj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f:\vA\0!B\0! "! A.F\r\f\v \0A\fj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f9\vA\0!B\0! "! A.F\r\f\v \0A\rj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f8\vA\0!B\0! "! A.F\r\f\x1B\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f7\vA\0!B\0! "! A.F\r\f\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f6\vA\0!B\0! "! A.F\r\f\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f5\vA\0!B\0! "! A.F\r\f\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f4\vA\0!B\0! "! A.F\r\f\v \0Aj! -\0\x80AqE@ B\0 }  \x1BA-F"\0\x1B7\b B\fB \0\x1B7\0 !\f3\vA\0!B\0! "! A.F\r\f\v@ A0kA\xFFqA	K\r\0 \0-\0-\0\x80Aq\r\0 B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCZ@ B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCR\r A5K\r\v \0Aj! \xAD B\n~|B0}! \x1BA-F@ B7\0  \xBA\x9A9\b\f3\v  7\b B7\0\f2\vA\0!B\0! A\xDFqA\xC5\0F@ "!A\0!\f\v A.G@ !A\0!\f\v \0-\0! \0Aj"!\0 A0kA\xFFqA	K\r!\f\vA\0!B\0! "! A.G\r\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0A\x07j! \0-\0\x07"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0A\bj! \0-\0\b"\xADB\xFF\x83B0}"B	V@ !\f\r\v  B\n~|!\v \0A	j! \0-\0	"\xADB\xFF\x83B0}"B	V@ !\f\f\v  B\n~|!\v \0A\nj! \0-\0\n"\xADB\xFF\x83B0}"B	V@ !\f\v\v  B\n~|!\v \0A\vj! \0-\0\v"\xADB\xFF\x83B0}"B	V@ !\f\n\v  B\n~|!\v \0A\fj! \0-\0\f"\xADB\xFF\x83B0}"B	V@ !\f	\v  B\n~|!\v \0A\rj! \0-\0\r"\xADB\xFF\x83B0}"B	V@ !\f\b\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\x07\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj! \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v \0Aj!  B\n~|! "! \0-\0"A0kA\xFFqA\nO\r\v !@ "Aj! -\0"A0kA\xFFqA\nI\r\0\v  A\xFFqA4K\xAD|!@ @ ! !\f\v A\xFFqA.G@ !\f\v Aj!\0 -\0A0kA\xFFqA	K\r@ \0"Aj!\0 -\0\0"A0kA\xFFqA\nI\r\0\v\v  k\xAC  I\xAD|! !@@@ Ak"-\0\0A.k\0\0\v  I\r\v\vA\0   I"\0\x1B!A\0  \0\x1B! A\xDFqA\xC5\0F\r\f\v  AjF@ !\0\f\r\vB  k"\0\xAC}!A\0! A\xDFqA\xC5\0F@ !\f\v \0A\xD9H@ !\f\v B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 \x1BA-F\x1B7\b !\f\v Aj -\0"-\0\x80Aqj"\0-\0\0"A0k"A\xFFqA	K\r\v@ A0F@@ \0"Aj!\0 -\0"A0F\r\0\vB\0!\b \0! A0k"A\xFFqA	K\r\vB\0!\b \0!@ \bB\n~ \xADB\xFF\x83|!\b "Aj! -\0A0k"A\xFFqA\nI\r\0\v\v  \0kAN@ !\0 A-G\r\f B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 \x1BA-F\x1B7\b\f\vB\0 \b} \b A-F\x1B |! !\v B\xA8}W@ B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 \x1BA-F\x1B7\b !\f\x1B\v ! B\xB4U\r	\v  \xA7"\x006\xEC\b@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFFV\r\0 \0AjA,K\r\0 \xBA!%| \0A\0H@ %A\x80 \0Atk+\0\xA3\f\v \0At+\x80 %\xA2\v!% B7\0  %\x9A % \x1BA-F\x1B9\b\f\v P@ B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 \x1BA-F\x1B7\b\f\v \0A\xEA\xA4\rlA\x80\x80\xFCkAu!\x7F@@@@ E \0A\xB2jA\xD2IqE@  y"\x86"\bB\xFF\xFF\xFF\xFF\x83! \bB \x88! \0At"\0A\xB8\xC0\0j)\0!\n \0A\xB0\xC0\0j)\0!	 \xA7!\f\v y"\xA7! \0At"\0A\xB0\xC0\0j)\0"	B\xFF\xFF\xFF\xFF\x83"\b  \x86"\vB\xFF\xFF\xFF\xFF\x83"~"\fB \x88 	B \x88"\n ~|"\rB \x88 \n \vB \x88"~|  \b~ \rB\xFF\xFF\xFF\xFF\x83|"\rB \x88|"\bB\xFF\x83B}B\xFET\r  \0A\xB8\xC0\0j)\0"\n \v\r \fB\xFF\xFF\xFF\xFF\x83 \rB \x86\x84"\v )\b|"\fB}B}X\r\vB\0!\bB\bB	BB\0 \x1B \x86"P\x1B | \nB?\x88 	|"B\xFF\xFF\xFF\xFF\x83"	 ~B \x88  B \x88"~|"B \x88  ~|  	~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\x88B\x83|"y"\x86!  \x86!A\xC0\0!A\v   \xA7jkA@k"\0A\xC2wJ\r \0A\x8FwI\rA\xCEw \0k! \0A\x91wM\r \f\v \b \v \fV\xAD|!\b\v B7\0   k \bB\0Y"\0kA\xC1\0A\xC0\0 \b \0\xAD\x86"B\x80\b\x83 |"B\x80\bT\x1BjA\xBE\bj\xADB4\x86 B\v\x88B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83\x84B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 \x1BA-F\x1B\x847\b\f\x1B\v A<k" \0j!\0  \xAD"\x88!  \x88B	|!A<\v!@  \xAD"\x88 B\x7F \x86B\x7F\x85\x83B\x86"B\b Ak\xAD\x86"	 |Z"\xAD|"P\r\0 \0 j y"\n\xA7k"\0A\xC0\x07J\r	  \n\x86B\v\x88! \0A\xC3wN@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83 \0A\xBE\bj\xADB4\x86\x84!\b\f\v \0A\x8FwI\r\0 A\xC3w \0k\xAD\x88!\b\v  	 }X\r \r A\xE0j  A\xEC\bj     \b \bB\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83B\x80\x80\x80\x80\x80\x80\x80\b\x84 \bB\x80\x80\x80\x80\x80\x80\x80\bT"\0\x1BB\x86B\x847`A\xCDw \bB4\x88\xA7A\xB4\bk \0\x1B! A\xE0\0j! (\xEC\b"A\0N@ (\xE0!\0 AO@ A\xE8j!@ !A\0!@@ \0E\r\0@  Atj)\0B\0R\r Aj" \0G\r\0\v\f\vB\0! \0 M\r\0@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"B\x80\x80\xA0\xCF\b~"B \x88 B\x84\xC6\x9C\xD6\b~|"B\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"	7\0  	V\xAD B\x84\xC6\x9C\xD6\b~ B \x88| B \x88||! Aj" \0G\r\0\v P\r\0  \0Atj 7\0 \0Aj!\0\v Ak! A%J\r\0\v\v  \x006\xE0A! E\r AtA\x80\xE9\0j)\0! A\xE8j!A\0!@ \0E\r\0@  Atj)\0B\0R\r Aj" \0G\r\0\v\f\v \0 M\r B\xFF\xFF\xFF\xFF\x83! B \x88!B\0!@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" ~"	B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" ~|"\nB \x86 	B\xFF\xFF\xFF\xFF\x83\x84"	|"\v7\0 	 \vV\xAD  ~ B \x88| \nB \x88||! Aj" \0G\r\0\v P\r  \0Aj6\xE0  \0Atj 7\0\f\vA\0 k!A!\0 AnO\r@ !A\0!@@ \0E\r\0@  Atj)\0B\0R\r Aj" \0G\r\0\v\f\vB\0! \0 M\r\0@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"B\x80\x80\xA0\xCF\b~"B \x88 B\x84\xC6\x9C\xD6\b~|"B\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"	7\0  	V\xAD B\x84\xC6\x9C\xD6\b~ B \x88| B \x88||! Aj" \0G\r\0\v P\r\0  \0Atj 7\0 \0Aj!\0\v Ak! A%J\r\0\v  \x006X E@ \0!\f\vA\0! \0E\r\f\v@ \0A\xDD\0k\0\v \0A"G\r@   Aj"K@ !\f\v Av j"A\xFE\xFF\xFF\xFF\0K@ !\0\f#\v  At"\0"E@ !\0\f#\v   kj!   kj! \0 jA k! \v Aj! Aj"!@@@\x7F  -\0\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 A\x07j -\0\x07"-\0\x80AqE\r\0 A\bj -\0\b"-\0\x80AqE\r\0 A	j -\0	"-\0\x80AqE\r\0 A\nj -\0\n"-\0\x80AqE\r\0 A\vj -\0\v"-\0\x80AqE\r\0 A\fj -\0\f"-\0\x80AqE\r\0 A\rj -\0\r"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 -\0"-\0\x80Aq\r Aj\v!B\r!\b A"F@ !\f\x1B\v \xC0A\0H\rB!\b !@ A\xFFq"\0A\xDC\0G@ \0A"G\r\f\v\x7F@@@@@@@@@@ -\0A"kT\0\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x07\b\x1B\v A":\0\0\f\b\v A\xDC\0:\0\0\f\x07\v A/:\0\0\f\v A\b:\0\0\f\v A\f:\0\0\f\v A\n:\0\0\f\v A\r:\0\0\f\v A	:\0\0\f\v -\0-\0\x80 -\0-\0\x80A\btr" -\0-\0\x80 -\0-\0\x80A\btr"rA\xF0\xE1q\r Aj!\0  Atr"A\x80\xF0qA\x80\xB0G@ A\xFF\xFFq"A\x80O@  A?qA\x80r:\0  AvA?qA\x80r:\0  A\x80\xE0qA\fvA\xE0r:\0\0 Aj\f\v A\x80O@  A?qA\x80r:\0  AvA\xC0r:\0\0 Aj\f\v  :\0\0 Aj\f\v A\x80\xB8qA\x80\xB0G\r \0/\0\0A\xDC\xEAG\r -\0\v-\0\x80 -\0	-\0\x80A\btr"\0 -\0\n-\0\x80 -\0\b-\0\x80A\btr"rA\xF0\xE1q\r \0 Atr"\0A\x80\xF8qA\x80\xB8G\r  \0A?qA\x80r:\0  \0A\xFF\xBFq A\ntA\x80\xF8\xBF\x1Bqj"\0A\x80\xB8\xFFk"AvA\xF0r:\0\0  \0AvAjA?qA\x80r:\0  A\fvA?qA\x80r:\0 A\fj!\0 Aj\f\v Aj!\0 Aj\v!@@ \0-\0\0"-\0\x80AqE@ \0!\f\v\x7F@@@@@@@@@@@@@ \0-\0-\0\x80Aq@ \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0\x07-\0\x80AqE\r \0-\0\b-\0\x80AqE\r\x07 \0-\0	-\0\x80AqE\r\b \0-\0\n-\0\x80AqE\r	 \0-\0\v-\0\x80AqE\r\n \0-\0\f-\0\x80AqE\r\v \0-\0\r-\0\x80AqE\r\f \0-\0-\0\x80AqE\r\r \0-\0 \0)\0\0!  \0)\0\b7\0\b  7\0\0-\0\x80AqE@ \0Aj!A\f\v \0Aj!\0 Aj!\f\v \0Aj!  \0/\0\0;\0\0A\f\r\v \0Aj!  \0/\0\0;\0\0A\f\f\v \0Aj!  \0(\0\x006\0\0A\f\v\v \0Aj!  \0(\0\x006\0\0A\f\n\v \0Aj!  \0(\0\x006\0\0  \0/\0;\0A\f	\v \0Aj!  \0(\0\x006\0\0  \0/\0;\0A\f\b\v \0A\x07j!  \0)\0\x007\0\0A\x07\f\x07\v \0A\bj!  \0)\0\x007\0\0A\b\f\v \0A	j!  \0)\0\x007\0\0  \0/\0\b;\0\bA	\f\v \0A\nj!  \0)\0\x007\0\0  \0/\0\b;\0\bA\n\f\v \0A\vj!  \0)\0\x007\0\0  \0(\0\b6\0\bA\v\f\v \0A\fj!  \0)\0\x007\0\0  \0(\0\b6\0\bA\f\f\v \0A\rj!  \0)\0\x007\0\0  \0(\0\b6\0\b  \0/\0\f;\0\fA\r\f\v \0Aj!  \0)\0\x007\0\0  \0(\0\b6\0\b  \0/\0\f;\0\fA\v j! -\0\0!\v \xC0A\0N\r@ ""\0(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"\0E@ !\0\f\v \0A\x8D\xC0\0F@ !\0\f\v  6\0\0 Aj! (\0! Aj"\0! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 \0! AqE\r\0@  ;\0\0 Aj!\0 Aj! (\0"A\xE0\x81qA\xC0\x81G\r \0! Aq\r\0\v\v@ A\x87\xE0\0qE\r\0 A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0@ AqE@ \0!\f\v \0! A\x83\xE0\0q\r\v@  6\0\0 Aj!\0 Aj! (\0"A\x87\xE0\0qE\r A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r \0! AqE\r\0 A\x83\xE0\0qE\r\0\v\v \0 G\r\0\v\v \0!\f\v Aj!\f\v "\0!@ \0(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ \0!\f\v A\x8D\xC0\0F@ \0!\f\v \0(\0! \0Aj"!\0 A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 !\0 AqE\r\0@ \0Aj! \0(\0"A\xE0\x81qA\xC0\x81G\r !\0 Aq\r\0\v\v@ A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0 !\0 A\x87\xE0\0qE\r\0@@ AqE\r\0 A\x83\xE0\0qE\r\0 \0!\f\v \0Aj! \0(\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r !\0 A\x87\xE0\0q\r\0\v\v  G\r\0\v\f\f\v A6X\v AtA\x80\xE9\0j)\0!A\0!@@  Atj)\0B\0R\r Aj" \0G\r\0\v \0!\f\v \0 M@ \0!\f\v B\xFF\xFF\xFF\xFF\x83! B \x88!B\0!@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" ~"	B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" ~|"\nB \x86 	B\xFF\xFF\xFF\xFF\x83\x84"	|"\v7\0 	 \vV\xAD  ~ B \x88| \nB \x88||! Aj" \0G\r\0\v P@ \0!\f\v  \0Atj 7\0 \0Aj!\v@@@ A\0J@ Av! A?q"\0E@@ E\r\0 "Aq"@A\0!\0@ A\xD8\0j Atj" Atj )\x007\0 Ak! \0Aj"\0 G\r\0\v\v AI\r\0@ A\xD8\0j Atj"\0 At"j \0)\x007\0 \0A\bk" j )\x007\0 \0Ak" j )\x007\0 \0Ak"\0 j \0)\x007\0 Ak"\r\0\v\v   j"6X\f\v  Atj"B\x007\0 \0\xAD!@ E\r\0A\xC0\0 \0k\xAD! "Aq@  Atj A\xD8\0j Atj)\0 \x887\0 Ak!\v AF\r\0 At" A\xD8\0jj!@  At"\0j" j )\0 \x86 A\xD8\0j \0j")\0" \x88\x847\0 \0 j  \x86 A\bk)\0 \x88\x847\0 Ak"\r\0\v\v  At"\0j )` \x867\0  j \0 j)\0B\0Rj! \r\f\vA\0 k"\0Av! (\xE0! \0A?q"\0E@@ E\r\0 "Aq"@A\0!\0@ A\xE0j Atj" Atj )\x007\0 Ak! \0Aj"\0 G\r\0\v\v AI\r\0@ A\xE0j Atj"\0 At"j \0)\x007\0 \0A\bk" j )\x007\0 \0Ak" j )\x007\0 \0Ak"\0 j \0)\x007\0 Ak"\r\0\v\v   j"6\xE0 E\r A\xE8j!\f\v A\xE8j" Atj"B\x007\0 \0\xAD!@ E\r\0A\xC0\0 \0k\xAD! "Aq@  Atj A\xE0j Atj)\0 \x887\0 Ak!\v AF\r\0 At" A\xE0jj!@  At"\0j" j )\0 \x86 A\xE0j \0j")\0" \x88\x847\0 \0 j  \x86 A\bk)\0 \x88\x847\0 Ak"\r\0\v\v  At"\0j )\xE8 \x867\0   j \0 j)\0B\0Rj"6\xE0 E\r\v At"\0E\r\0 A\0 \0\xFC\v\0\v (\xE0!\vA\x7F!\0~@@  K\r\0A!\0  I\r\0 E\r@@A\x7FA \0 At"\0 A\xE0jj)\0" A\xD8\0j \0j)\0"V\x1B  T\x1B!\0  R\r\0 Ak"\r\f\v\v \0E\r\v \0A\0J\xAD\f\v \bB\x83\v \b|"\bB\x80\x80\x80\x80\x80\x80\x80\xF8\xFF\0Q\r\v B7\0  \bB\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 \x1BA-F\x1B\x847\b\f\v Aq@@ "\0Aj! \0-\0"-\0\x80Aq\r\0\v\f !\f	\v\0\v\0\v -\0\0!@@@@ A\xFFq"\0A"G@ \0A\xFD\0G\r Aj!B\x07! \r\r !\f\v@   Aj"K@ !\f\v Av j"A\xFE\xFF\xFF\xFF\0K@ !\0\f \v  At"\0"E@ !\0\f \v   kj!   kj! \0 jA k! \v Aj"!@@@\x7F  -\0\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 A\x07j -\0\x07"-\0\x80AqE\r\0 A\bj -\0\b"-\0\x80AqE\r\0 A	j -\0	"-\0\x80AqE\r\0 A\nj -\0\n"-\0\x80AqE\r\0 A\vj -\0\v"-\0\x80AqE\r\0 A\fj -\0\f"-\0\x80AqE\r\0 A\rj -\0\r"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 -\0"-\0\x80Aq\r Aj\v!B\r!\b A"F@ !\f\x07\v \xC0A\0H\rB!\b !@ A\xFFq"\0A\xDC\0G@ \0A"G\r\f\b\v\x7F@@@@@@@@@@ -\0A"kT\0\x07\b\v A":\0\0\f\b\v A\xDC\0:\0\0\f\x07\v A/:\0\0\f\v A\b:\0\0\f\v A\f:\0\0\f\v A\n:\0\0\f\v A\r:\0\0\f\v A	:\0\0\f\v -\0-\0\x80 -\0-\0\x80A\btr" -\0-\0\x80 -\0-\0\x80A\btr"rA\xF0\xE1q\r Aj!\0  Atr"A\x80\xF0qA\x80\xB0G@ A\xFF\xFFq"A\x80O@  A?qA\x80r:\0  AvA?qA\x80r:\0  A\x80\xE0qA\fvA\xE0r:\0\0 Aj\f\v A\x80O@  A?qA\x80r:\0  AvA\xC0r:\0\0 Aj\f\v  :\0\0 Aj\f\v A\x80\xB8qA\x80\xB0G\r \0/\0\0A\xDC\xEAG\r -\0\v-\0\x80 -\0	-\0\x80A\btr"\0 -\0\n-\0\x80 -\0\b-\0\x80A\btr"rA\xF0\xE1q\r \0 Atr"\0A\x80\xF8qA\x80\xB8G\r  \0A?qA\x80r:\0  \0A\xFF\xBFq A\ntA\x80\xF8\xBF\x1Bqj"\0A\x80\xB8\xFFk"AvA\xF0r:\0\0  \0AvAjA?qA\x80r:\0  A\fvA?qA\x80r:\0 A\fj!\0 Aj\f\v Aj!\0 Aj\v!@@ \0-\0\0"-\0\x80AqE@ \0!\f\v\x7F@@@@@@@@@@@@@ \0-\0-\0\x80Aq@ \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0\x07-\0\x80AqE\r \0-\0\b-\0\x80AqE\r\x07 \0-\0	-\0\x80AqE\r\b \0-\0\n-\0\x80AqE\r	 \0-\0\v-\0\x80AqE\r\n \0-\0\f-\0\x80AqE\r\v \0-\0\r-\0\x80AqE\r\f \0-\0-\0\x80AqE\r\r \0-\0 \0)\0\0!  \0)\0\b7\0\b  7\0\0-\0\x80AqE@ \0Aj!A\f\v \0Aj!\0 Aj!\f\v \0Aj!  \0/\0\0;\0\0A\f\r\v \0Aj!  \0/\0\0;\0\0A\f\f\v \0Aj!  \0(\0\x006\0\0A\f\v\v \0Aj!  \0(\0\x006\0\0A\f\n\v \0Aj!  \0(\0\x006\0\0  \0/\0;\0A\f	\v \0Aj!  \0(\0\x006\0\0  \0/\0;\0A\f\b\v \0A\x07j!  \0)\0\x007\0\0A\x07\f\x07\v \0A\bj!  \0)\0\x007\0\0A\b\f\v \0A	j!  \0)\0\x007\0\0  \0/\0\b;\0\bA	\f\v \0A\nj!  \0)\0\x007\0\0  \0/\0\b;\0\bA\n\f\v \0A\vj!  \0)\0\x007\0\0  \0(\0\b6\0\bA\v\f\v \0A\fj!  \0)\0\x007\0\0  \0(\0\b6\0\bA\f\f\v \0A\rj!  \0)\0\x007\0\0  \0(\0\b6\0\b  \0/\0\f;\0\fA\r\f\v \0Aj!  \0)\0\x007\0\0  \0(\0\b6\0\b  \0/\0\f;\0\fA\v j! -\0\0!\v \xC0A\0N\r@ ""\0(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"\0E@ !\0\f\v \0A\x8D\xC0\0F@ !\0\f\v  6\0\0 Aj! (\0! Aj"\0! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 \0! AqE\r\0@  ;\0\0 Aj!\0 Aj! (\0"A\xE0\x81qA\xC0\x81G\r \0! Aq\r\0\v\v@ A\x87\xE0\0qE\r\0 A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0@ AqE@ \0!\f\v \0! A\x83\xE0\0q\r\v@  6\0\0 Aj!\0 Aj! (\0"A\x87\xE0\0qE\r A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r \0! AqE\r\0 A\x83\xE0\0qE\r\0\v\v \0 G\r\0\v\v \0!\f\f\v Aj!\f\v "\0!@ \0(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ \0!\f\v A\x8D\xC0\0F@ \0!\f\v \0(\0! \0Aj"!\0 A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 !\0 AqE\r\0@ \0Aj! \0(\0"A\xE0\x81qA\xC0\x81G\r !\0 Aq\r\0\v\v@ A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0 !\0 A\x87\xE0\0qE\r\0@@ AqE\r\0 A\x83\xE0\0qE\r\0 \0!\f\v \0Aj! \0(\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r !\0 A\x87\xE0\0q\r\0\v\v  G\r\0\v\f	\vA\f\v \0-\0\x80Aq@@ "\0Aj! \0-\0"-\0\x80Aq\r\0\f\v\0\v\v AA  A\x1B6\xE0 \x07\f\v  6\b   k\xACB\b\x86 \b\x847\0 A\0:\0\0 Aj! -\0"\0A:G@ Aj! \0-\0\x80!\0@ \0AqE@ AA  A\x1B6\xE0\f\v@ "Aj! -\0"-\0\x80"\0Aq\r\0\v A:G\r\0\v\v Aj! -\0"A"F\r -\0\x80!\0@@@@ \0Aq@ A\x006\xEC\b Aj! Aj!@@@@@@@@@@@@@@@@@@@@@@@  A\xFFqA-F"j"\0-\0\0"A1kA\xFFqA	O@ A0G\r \0Aj! \0-\0"-\0\x80AqE@ B\x007 B\fB \x1B7 !\f"\v@ A.F@ \0Aj! \0-\0"A0kA\xFFqA	K@ !\0\f!\v A\xFFqA0F@@ "\0Aj! \0-\0"A0F\r\0\v A0kA\xFFqA	K\r\v Ak!\0 \xADB\xFF\x83B0}!\f\v ! A0kA\xFFqA\nI\r\v A\xDFqA\xC5\0F@ AA -\0-\0\x80Aq\x1Bj"-\0\0A0kA\xFFqA	K@ !\0\f \v@ "\0Aj! \0-\0A0kA\xFFqA\nI\r\0\v\v B7 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7\f!\v \xADB\xFF\x83"B0}!@@@@@@@@@@@@@@@@@@@ \0-\0"\xADB0}"\bB	X@ \b B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0\x07"\xADB0}"B	V\r  B\n~|! \0-\0\b"\xADB0}"B	V\r\x07  B\n~|! \0-\0	"\xADB0}"B	V\r\b  B\n~|! \0-\0\n"\xADB0}"B	V\r	  B\n~|! \0-\0\v"\xADB0}"B	V\r\n  B\n~|! \0-\0\f"\xADB0}"B	V\r\v  B\n~|! \0-\0\r"\xADB0}"B	V\r\f  B\n~|! \0-\0"\xADB0}"B	V\r\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r  B\n~|! \0-\0"\xADB0}"B	V\r \0Aj!  B\n~|! \0-\0"-\0\x80Aq\r@ A\xFFq"\0A-G\r\0 B\x81\x80\x80\x80\x80\x80\x80\x80\x80\x7FT\r\0 B7  \xBA\x9A9\f5\v B\0 }  \0A-F"\0\x1B7 B\fB \0\x1B7\f4\v \0Aj! -\0\x80Aq\r B0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f3\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f3\vA\0!B\0! "!\x1B A.F\r\f&\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f2\vA\0!B\0! "!\x1B A.F\r\f%\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f1\vA\0!B\0! "!\x1B A.F\r\f$\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f0\vA\0!B\0! "!\x1B A.F\r\f#\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f/\vA\0!B\0! "!\x1B A.F\r\f"\v \0A\x07j! -\0\x80AqE@ B\fB A\xFFqA-F"\0\x1B7\0 B\0 }  \0\x1B7 !\f.\vA\0!B\0! "!\x1B A.F\r\f!\v \0A\bj! -\0\x80AqE@ B\fB A\xFFqA-F"\0\x1B7\0 B\0 }  \0\x1B7 !\f-\vA\0!B\0! "!\x1B A.F\r\f \v \0A	j! -\0\x80AqE@ B\fB A\xFFqA-F"\0\x1B7\0 B\0 }  \0\x1B7 !\f,\vA\0!B\0! "!\x1B A.F\r\f\v \0A\nj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f+\vA\0!B\0! "!\x1B A.F\r\f\v \0A\vj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f*\vA\0!B\0! "!\x1B A.F\r\f\v \0A\fj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f)\vA\0!B\0! "!\x1B A.F\r\f\v \0A\rj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f(\vA\0!B\0! "!\x1B A.F\r\f\x1B\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f\'\vA\0!B\0! "!\x1B A.F\r\f\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f&\vA\0!B\0! "!\x1B A.F\r\f\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f%\vA\0!B\0! "!\x1B A.F\r\f\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f$\vA\0!B\0! "!\x1B A.F\r\f\v \0Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\0\x1B7 B\fB \0\x1B7 !\f#\vA\0!B\0! "!\x1B A.F\r\f\v@ A0kA\xFFqA	K\r\0 \0-\0-\0\x80Aq\r\0 B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCZ@ B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCR\r A5K\r\v \0Aj! \xAD B\n~|B0}! A\xFFqA-F@ B7  \xBA\x9A9\f#\v  7 B7\f"\vA\0!\x1BB\0! A\xDFqA\xC5\0F@ "!A\0!\f\v A.G@ !\x1BA\0!\f\v \0-\0! \0Aj"\x1B!\0 A0kA\xFFqA	K\r\f\vA\0!B\0! "!\x1B A.G\r\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0A\x07j!\x1B \0-\0\x07"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0A\bj!\x1B \0-\0\b"\xADB\xFF\x83B0}"B	V@ !\f\r\v  B\n~|!\v \0A	j!\x1B \0-\0	"\xADB\xFF\x83B0}"B	V@ !\f\f\v  B\n~|!\v \0A\nj!\x1B \0-\0\n"\xADB\xFF\x83B0}"B	V@ !\f\v\v  B\n~|!\v \0A\vj!\x1B \0-\0\v"\xADB\xFF\x83B0}"B	V@ !\f\n\v  B\n~|!\v \0A\fj!\x1B \0-\0\f"\xADB\xFF\x83B0}"B	V@ !\f	\v  B\n~|!\v \0A\rj!\x1B \0-\0\r"\xADB\xFF\x83B0}"B	V@ !\f\b\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\x07\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v \0Aj!\x1B \0-\0"\xADB\xFF\x83B0}"B	V@ !\f\v \0Aj!\x1B  B\n~|! "! \0-\0"A0kA\xFFqA\nO\r\v \x1B!@ "Aj! -\0"A0kA\xFFqA\nI\r\0\v  A\xFFqA4K\xAD|!@ @ ! !\f\v A\xFFqA.G@ !\f\v Aj!\0 -\0A0kA\xFFqA	K\r\v@ \0"Aj!\0 -\0\0"A0kA\xFFqA\nI\r\0\v\v  \x1Bk\xAC  \x1BI\xAD|! !\0@@@ \0Ak"\0-\0\0A.k\0\0\v \0 K\r\v\vA\0 \x1B \0 \x1BI"\0\x1B!A\0  \0\x1B!\x1B A\xDFqA\xC5\0F\r\f\v \x1B AjF@ \x1B!\0\f\n\vB \x1B k"\0\xAC}!A\0! A\xDFqA\xC5\0F@ \x1B!\f\v \0A\xD9H@ \x1B!\f\v B7 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7 \x1B!\f\f\v Aj -\0"-\0\x80Aqj"\0-\0\0"A0k"A\xFFqA	K\r\b@ A0F@@ \0"Aj!\0 -\0"A0F\r\0\vB\0!\b \0! A0k"A\xFFqA	K\r\vB\0!\b \0!@ \bB\n~ \xADB\xFF\x83|!\b "Aj! -\0A0k"A\xFFqA\nI\r\0\v\v  \0kAN@ !\0 A-G\r	 B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7\f\f\vB\0 \b} \b A-F\x1B |! !\v B\xA8}W@ B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7 !\f\v\v ! B\xB4U\r\v  \xA7"\x006\xEC\b@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFFV\r\0 \0AjA,K\r\0 \xBA!%| \0A\0H@ %A\x80 \0Atk+\0\xA3\f\v \0At+\x80 %\xA2\v!% B7  %\x9A % A\xFFqA-F\x1B9\f\n\v P@ B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7\f\n\v \0A\xEA\xA4\rlA\x80\x80\xFCkAu!\x7F@@@@ E \0A\xB2jA\xD2IqE@  y"\x86"\bB\xFF\xFF\xFF\xFF\x83! \bB \x88! \0At"\0A\xB8\xC0\0j)\0!\n \0A\xB0\xC0\0j)\0!	 \xA7!\f\v y"\xA7! \0At"\0A\xB0\xC0\0j)\0"	B\xFF\xFF\xFF\xFF\x83"\b  \x86"\vB\xFF\xFF\xFF\xFF\x83"~"\fB \x88 	B \x88"\n ~|"\rB \x88 \n \vB \x88"~|  \b~ \rB\xFF\xFF\xFF\xFF\x83|"\rB \x88|"\bB\xFF\x83B}B\xFET\r Aj \0A\xB8\xC0\0j)\0"\n \v\r \fB\xFF\xFF\xFF\xFF\x83 \rB \x86\x84"\v )|"\fB}B}X\r\vB\0!\bB\bB	BB\0 \x1B \x86"P\x1B | \nB?\x88 	|"B\xFF\xFF\xFF\xFF\x83"	 ~B \x88  B \x88"~|"B \x88  ~|  	~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\x88B\x83|"y"\x86!  \x86!A\xC0\0!A\v   \xA7jkA@k"A\xC2wJ\r A\x8FwI\rA\xCEw k! A\x91wM\r \f\v \b \v \fV\xAD|!\b\v B7   k \bB\0Y"\0kA\xC1\0A\xC0\0 \b \0\xAD\x86"B\x80\b\x83 |"B\x80\bT\x1BjA\xBE\bj\xADB4\x86 B\v\x88B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83\x84B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B\x847\f\v\v A<k"\0 j!  \0\xAD"\x88!  \x88B	|!A<\v!\0@  \0\xAD"\x88 B\x7F \x86B\x7F\x85\x83B\x86"B\b \0Ak\xAD\x86"	 |Z"\xAD|"P\r\0 \0 j y"\n\xA7k"\0A\xC0\x07J\r  \n\x86B\v\x88! \0A\xC3wN@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83 \0A\xBE\bj\xADB4\x86\x84!\b\f\v \0A\x8FwI\r\0 A\xC3w \0k\xAD\x88!\b\v  	 }X\r\x07 \r\x07 A\xE0j  A\xEC\bj  \x1B   \b \bB\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83B\x80\x80\x80\x80\x80\x80\x80\b\x84 \bB\x80\x80\x80\x80\x80\x80\x80\bT"\0\x1BB\x86B\x847`A\xCDw \bB4\x88\xA7A\xB4\bk \0\x1B! A\xE0\0j! (\xEC\b"\0A\0N@ (\xE0! \0AO@ A\xE8j!@ \0!A\0!\0@@ E\r\0@  \0Atj)\0B\0R\r \0Aj"\0 G\r\0\v\f\vB\0! \0 O\r\0@  \0Atj"\x1B  \x1B)\0"B\xFF\xFF\xFF\xFF\x83"B\x80\x80\xA0\xCF\b~"B \x88 B\x84\xC6\x9C\xD6\b~|"B\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"	7\0  	V\xAD B\x84\xC6\x9C\xD6\b~ B \x88| B \x88||! \0Aj"\0 G\r\0\v P\r\0  Atj 7\0 Aj!\v Ak!\0 A%J\r\0\v\v  6\xE0A!\x1B \0E\r \0AtA\x80\xE9\0j)\0! A\xE8j!A\0!\0@ E\r\0@  \0Atj)\0B\0R\r \0Aj"\0 G\r\0\v\f\v \0 O\r B\xFF\xFF\xFF\xFF\x83! B \x88!B\0!@  \0Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" ~"	B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" ~|"\nB \x86 	B\xFF\xFF\xFF\xFF\x83\x84"	|"\v7\0 	 \vV\xAD  ~ B \x88| \nB \x88||! \0Aj"\0 G\r\0\v P\r  Aj6\xE0  Atj 7\0\f\vA\0 \0k!A! \0AnO\r@ !A\0!\0@@ E\r\0@  \0Atj)\0B\0R\r \0Aj"\0 G\r\0\v\f\vB\0! \0 O\r\0@  \0Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"B\x80\x80\xA0\xCF\b~"B \x88 B\x84\xC6\x9C\xD6\b~|"B\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"	7\0  	V\xAD B\x84\xC6\x9C\xD6\b~ B \x88| B \x88||! \0Aj"\0 G\r\0\v P\r\0  Atj 7\0 Aj!\v Ak! A%J\r\0\v  6X E@ !\x1B\f\vA\0!\x1B E\r\f\v@@@@ A\xFFqA\xDB\0k!\0\x1B\v (\0\0A\xF4\xE4\xD5\xABG\r B\v7 Aj! Aj! Aj!\f\v\v (\0A\xE1\xD8\xCD\xABG\r B7 Aj! Aj! Aj!\f\n\v (\0\0A\xEE\xEA\xB1\xE3G\r B7 Aj! Aj! Aj!\f	\v \0AqE\r\n@ "\0Aj! \0-\0"-\0\x80"\0Aq\r\0\v A"G\r\f\x07\v\v A6X\v AtA\x80\xE9\0j)\0!A\0!\0@@  \0Atj)\0B\0R\r \0Aj"\0 G\r\0\v !\x1B\f\v \0 O@ !\x1B\f\v B\xFF\xFF\xFF\xFF\x83! B \x88!B\0!@  \0Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" ~"	B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" ~|"\nB \x86 	B\xFF\xFF\xFF\xFF\x83\x84"	|"\v7\0 	 \vV\xAD  ~ B \x88| \nB \x88||! \0Aj"\0 G\r\0\v P@ !\x1B\f\v  Atj 7\0 Aj!\x1B\v@@@ A\0J@ Av! A?q"\0E@@ \x1BE\r\0 \x1B"\0Aq"@A\0!@ A\xD8\0j \0Atj" Atj )\x007\0 \0Ak!\0 Aj" G\r\0\v\v \x1BAI\r\0@ A\xD8\0j \0Atj" At"j )\x007\0 A\bk" j )\x007\0 Ak" j )\x007\0 Ak" j )\x007\0 \0Ak"\0\r\0\v\v  \x1B j"\x1B6X\f\v  \x1BAtj"B\x007\0 \0\xAD!@ \x1BE\r\0A\xC0\0 \0k\xAD! \x1B"\0Aq@  Atj A\xD8\0j \0Atj)\0 \x887\0 \0Ak!\0\v \x1BAF\r\0 At" A\xD8\0jj!@  \0At"j" j )\0 \x86 A\xD8\0j j")\0" \x88\x847\0  j  \x86 A\bk)\0 \x88\x847\0 \0Ak"\0\r\0\v\v  At"\0j )` \x867\0 \x1B j \0 j)\0B\0Rj!\x1B \r\f\vA\0 k"\0Av! (\xE0! \0A?q"\0E@@ E\r\0 "\0Aq"@A\0!@ A\xE0j \0Atj" Atj )\x007\0 \0Ak!\0 Aj" G\r\0\v\v AI\r\0@ A\xE0j \0Atj" At"j )\x007\0 A\bk" j )\x007\0 Ak" j )\x007\0 Ak" j )\x007\0 \0Ak"\0\r\0\v\v   j"\x006\xE0 E\r A\xE8j!\f\v A\xE8j" Atj"B\x007\0 \0\xAD!@ E\r\0A\xC0\0 \0k\xAD! "\0Aq@  Atj A\xE0j \0Atj)\0 \x887\0 \0Ak!\0\v AF\r\0 At" A\xE0jj!@  \0At"j"" j ")\0 \x86 A\xE0j j"")\0" \x88\x847\0  j  \x86 "A\bk)\0 \x88\x847\0 \0Ak"\0\r\0\v\v  At"\0j )\xE8 \x867\0   j \0 j)\0B\0Rj"\x006\xE0 E\r\v At"\0E\r\0 A\0 \0\xFC\v\0\v (\xE0!\0\vA\x7F!~@@ \0 \x1BI\r\0A! \0 \x1BK\r\0 \0E\r@@A\x7FA  \0At" A\xE0jj)\0" A\xD8\0j j)\0"V\x1B  T\x1B!  R\r\0 \0Ak"\0\r\f\v\v E\r\v A\0J\xAD\f\v \bB\x83\v \b|"\bB\x80\x80\x80\x80\x80\x80\x80\xF8\xFF\0R\r\v !\0\v AA	 \0 A	\x1B6\xE0\f\v B7  \bB\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B\x847\f\v Aj! Aj! Aj"!@@@@\x7F  -\0\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 A\x07j -\0\x07"-\0\x80AqE\r\0 A\bj -\0\b"-\0\x80AqE\r\0 A	j -\0	"-\0\x80AqE\r\0 A\nj -\0\n"-\0\x80AqE\r\0 A\vj -\0\v"-\0\x80AqE\r\0 A\fj -\0\f"-\0\x80AqE\r\0 A\rj -\0\r"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 -\0"-\0\x80Aq\r Aj\v!B\r!\b A"F@ !\f\v \xC0A\0H\rB!\b !@ A\xFFq"\0A\xDC\0G@ \0A"G\r\x07\f\v\x7F@@@@@@@@@@ -\0A"kT\0\x07\b\v A":\0\0\f\b\v A\xDC\0:\0\0\f\x07\v A/:\0\0\f\v A\b:\0\0\f\v A\f:\0\0\f\v A\n:\0\0\f\v A\r:\0\0\f\v A	:\0\0\f\v -\0-\0\x80 -\0-\0\x80A\btr" -\0-\0\x80 -\0-\0\x80A\btr"rA\xF0\xE1q\r\b Aj!\0  Atr"A\x80\xF0qA\x80\xB0G@ A\xFF\xFFq"A\x80O@  A?qA\x80r:\0  AvA?qA\x80r:\0  A\x80\xE0qA\fvA\xE0r:\0\0 Aj\f\v A\x80O@  A?qA\x80r:\0  AvA\xC0r:\0\0 Aj\f\v  :\0\0 Aj\f\v A\x80\xB8qA\x80\xB0G\r\b \0/\0\0A\xDC\xEAG\r\b -\0\v-\0\x80 -\0	-\0\x80A\btr"\0 -\0\n-\0\x80 -\0\b-\0\x80A\btr"rA\xF0\xE1q\r\b \0 Atr"\0A\x80\xF8qA\x80\xB8G\r\b  \0A?qA\x80r:\0  \0A\xFF\xBFq A\ntA\x80\xF8\xBF\x1Bqj"\0A\x80\xB8\xFFk"AvA\xF0r:\0\0  \0AvAjA?qA\x80r:\0  A\fvA?qA\x80r:\0 A\fj!\0 Aj\f\v Aj!\0 Aj\v!@@ \0-\0\0"-\0\x80AqE@ \0!\f\v\x7F@@@@@@@@@@@@@ \0-\0-\0\x80Aq@ \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0-\0\x80AqE\r \0-\0\x07-\0\x80AqE\r \0-\0\b-\0\x80AqE\r\x07 \0-\0	-\0\x80AqE\r\b \0-\0\n-\0\x80AqE\r	 \0-\0\v-\0\x80AqE\r\n \0-\0\f-\0\x80AqE\r\v \0-\0\r-\0\x80AqE\r\f \0-\0-\0\x80AqE\r\r \0-\0 \0)\0\0!  \0)\0\b7\0\b  7\0\0-\0\x80AqE@ \0Aj!A\f\v \0Aj!\0 Aj!\f\v \0Aj!  \0/\0\0;\0\0A\f\r\v \0Aj!  \0/\0\0;\0\0A\f\f\v \0Aj!  \0(\0\x006\0\0A\f\v\v \0Aj!  \0(\0\x006\0\0A\f\n\v \0Aj!  \0(\0\x006\0\0  \0/\0;\0A\f	\v \0Aj!  \0(\0\x006\0\0  \0/\0;\0A\f\b\v \0A\x07j!  \0)\0\x007\0\0A\x07\f\x07\v \0A\bj!  \0)\0\x007\0\0A\b\f\v \0A	j!  \0)\0\x007\0\0  \0/\0\b;\0\bA	\f\v \0A\nj!  \0)\0\x007\0\0  \0/\0\b;\0\bA\n\f\v \0A\vj!  \0)\0\x007\0\0  \0(\0\b6\0\bA\v\f\v \0A\fj!  \0)\0\x007\0\0  \0(\0\b6\0\bA\f\f\v \0A\rj!  \0)\0\x007\0\0  \0(\0\b6\0\b  \0/\0\f;\0\fA\r\f\v \0Aj!  \0)\0\x007\0\0  \0(\0\b6\0\b  \0/\0\f;\0\fA\v j! -\0\0!\v \xC0A\0N\r@ ""\0(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"\0E@ !\0\f\v \0A\x8D\xC0\0F@ !\0\f\v  6\0\0 Aj! (\0! Aj"\0! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 \0! AqE\r\0@  ;\0\0 Aj!\0 Aj! (\0"A\xE0\x81qA\xC0\x81G\r \0! Aq\r\0\v\v@ A\x87\xE0\0qE\r\0 A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0@ AqE@ \0!\f\v \0! A\x83\xE0\0q\r\v@  6\0\0 Aj!\0 Aj! (\0"A\x87\xE0\0qE\r A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r \0! AqE\r\0 A\x83\xE0\0qE\r\0\v\v \0 G\r\0\v\v \0!\f\v Aj!\f\v "\0!@ \0(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ \0!\f\v A\x8D\xC0\0F@ \0!\f\v \0(\0! \0Aj"!\0 A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r@ A\xE0\x81qA\xC0\x81G\r\0 !\0 AqE\r\0@ \0Aj! \0(\0"A\xE0\x81qA\xC0\x81G\r !\0 Aq\r\0\v\v@ A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0 !\0 A\x87\xE0\0qE\r\0@@ AqE\r\0 A\x83\xE0\0qE\r\0 \0!\f\v \0Aj! \0(\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r !\0 A\x87\xE0\0q\r\0\v\v  G\r\f\v\v  6   k\xACB\b\x86 \b\x847 A\0:\0\0 Aj!\vA\f\r\v AA\n  A\n\x1B6\xE0\f\v AA  A\x1B6\xE0\f\v Aj!B!\x07 E@ !\f\v\v@ Ak"-\0\0A,G\r\0\v AA\x07  A\x07\x1B6\xE0 \x07\f\vA\f\b\v@   Aj"K@ !\f\v Av j"A\xFE\xFF\xFF\xFF\0K@ !\0\f\v  At"\0"E@ !\0\f\v   kj!   kj! \0 jA k! \v (\0\0A\xEE\xEA\xB1\xE3G\r\0 B7\0 Aj! Aj!\f\v AA\v  A\v\x1B6\xE0\f\v@   Aj"K@ !\f\v Av j"A\xFE\xFF\xFF\xFF\0K@ !\0\f\v  At"\0"E@ !\0\f\v   kj!   kj! \0 jA k! \v (\0A\xE1\xD8\xCD\xABG\r\0 B7\0 Aj! Aj!\f\v AA\v  A\v\x1B6\xE0\f\v@   Aj"K@ !\f\v Av j"A\xFE\xFF\xFF\xFF\0K@ !\0\f\r\v  At"\0"E@ !\0\f\r\v   kj!   kj! \0 jA k! \v (\0\0A\xF4\xE4\xD5\xABG\r\0 B\v7\0 Aj! Aj!\f\v AA\v  A\v\x1B6\xE0\f\f\v  6\b   k\xACB\b\x86 \b\x847\0 A\0:\0\0 Aj!\vA\0\v!@@@@@@@@@@@@ \0\b\v -\0\0!@ A\xFFq"\0A\xDD\0G@ \0A,F@ Aj! !\f\b\v \0-\0\x80AqE\r@ "\0Aj! \0-\0"-\0\x80Aq\r\0\v\f\v\v Aj! A\btAr\xAD!\x07A!\f\n\v  \x077\0 (\b!\0   kAj6\b \0E\r\x07\f\b\v -\0\0!@ A\xFFq"\0A,F\r \0A\xFD\0F@ Aj! A\x07tA\x07r\xAD!A!\f\n\v \0-\0\x80AqE\r@ "\0Aj! \0-\0"-\0\x80Aq\r\0\v\f\0\v\0\v AA  A\x1B6\xE0\f\v AA  A\x1B6\xE0\f\v Aj! !\f\vA\0!\f\vA!\f\v  7\0 (\b!\0   kAj6\b \0E\r\0\f\v  O\r\x07 -\0\0-\0\x80Aq@@ "\0Aj! \0-\0-\0\x80Aq\r\0\v\v  O\r\x07 AA  A\x1B6\xE0\f\v\v  \0k")\0"B\b\x88\xA7! B\x07\x83B\x07Q@A!A\0!\v\f\0\v\0\v\v  1\0\0 \xADB\b\x86\x84B\x80|7\0 Aj!\x7F   Aj"K@ !\0 ! \f\v Av j"A\xFE\xFF\xFF\xFF\0K\r  At""E\r   kj!\0  jA k!    kj\v"B\x077\0   \0k6\bA\0!A!\f\v  1\0\0 \xADB\b\x86\x84B\x80|7\0 Aj!\x7F   Aj"K@ !\0 ! \f\v Av j"A\xFE\xFF\xFF\xFF\0K\r  At""E\r   kj!\0  jA k!    kj\v"B7\0   \0k6\bA\0!A\0!\f\0\v\0\v@\x7F E@ !A\0\f\v !A\v!@@@\x7F@@@@@@@@@@@@@@@@@@@@@@@@ E@@@ /\0\0"A\xA0\xC0\0G\r\0@@@@@@@@@@@@@@@@ /\0"A\xA0\xC0\0G\r /\0"A\xA0\xC0\0G\r /\0"A\xA0\xC0\0G\r\r /\0\b"A\xA0\xC0\0G\r\f /\0\n"A\xA0\xC0\0G\r\v /\0\f"A\xA0\xC0\0G\r\n /\0"A\xA0\xC0\0G\r	 /\0"A\xA0\xC0\0G\r\b /\0"A\xA0\xC0\0G\r\x07 /\0"A\xA0\xC0\0G\r /\0"A\xA0\xC0\0G\r /\0"A\xA0\xC0\0G\r /\0"A\xA0\xC0\0G\r /\0"A\xA0\xC0\0G\r /\0"A\xA0\xC0\0G\r /\0 ! A j! A\xA0\xC0\0F\r\0\v\f\v Aj!\f\v Aj!\f\r\v Aj!\f\f\v Aj!\f\v\v Aj!\f\n\v Aj!\f	\v Aj!\f\b\v Aj!\f\x07\v Aj!\f\v A\fj!\f\v A\nj!\f\v A\bj!\f\v Aj!\f\v Aj!\f\v Aj!\v A\xFFq"A\xDB\0F@ !  !\f\v A\xFB\0F@ !  !\f\v@@@@@ -\0\x80"Aq@  Aj"M@ \x1BAv \x1Bj"\x1BA\xFE\xFF\xFF\xFF\0K@ !\0\f*\v  \x1BAt""E@ !\0\f*\v   kj!   kj! " jA k!\v A\x006\xEC\b  Aj! @@@@@@@@@@@@@@@@@@@@@@@  -\0\0"A-Fj"-\0\0"A1kA\xFFqA	O@ A0G\r% Aj! -\0"-\0\x80AqE@ B\x007\b B\fB A-F\x1B7\0 !\f8\v@ A.F@ Aj! -\0"A0kA\xFFqA	K@ !\f(\v A\xFFqA0F@@ "Aj! -\0"A0F\r\0\v A0kA\xFFqA	K\r\v Ak! \xADB\xFF\x83B0}!\f\v ! A0kA\xFFqA\nI\r&\v A\xDFqA\xC5\0F@ AA -\0-\0\x80Aq\x1Bj"-\0\0A0kA\xFFqA	K@ !\f\'\v@ "Aj! -\0A0kA\xFFqA\nI\r\0\v\v B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7\b\f7\v \xADB\xFF\x83"B0}!@@@@@@@@@@@@@@@@@@@ -\0"\xADB0}"\x07B	X@ \x07 B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0\x07"\xADB0}"B	V\r  B\n~|! -\0\b"\xADB0}"B	V\r\x07  B\n~|! -\0	"\xADB0}"B	V\r\b  B\n~|! -\0\n"\xADB0}"B	V\r	  B\n~|! -\0\v"\xADB0}"B	V\r\n  B\n~|! -\0\f"\xADB0}"B	V\r\v  B\n~|! -\0\r"\xADB0}"B	V\r\f  B\n~|! -\0"\xADB0}"B	V\r\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r Aj!  B\n~|! -\0"-\0\x80Aq\r@ A-G\r\0 B\x81\x80\x80\x80\x80\x80\x80\x80\x80\x7FT\r\0 B7\0  \xBA\x9A9\b\fK\v B\0 }  A-F"\x1B7\b B\fB \x1B7\0\fJ\v Aj! -\0\x80Aq\r B0 }  A-F"\x1B7\b B\fB \x1B7\0 !\fI\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\fI\vA\0!B\0! "! A.F\r\f&\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\fH\vA\0!B\0! "! A.F\r\f%\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\fG\vA\0!B\0! "! A.F\r\f$\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\fF\vA\0!B\0! "! A.F\r\f#\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\fE\vA\0!B\0! "! A.F\r\f"\v A\x07j! -\0\x80AqE@ B\fB A-F"\x1B7\0 B\0 }  \x1B7\b !\fD\vA\0!B\0! "! A.F\r\f!\v A\bj! -\0\x80AqE@ B\fB A-F"\x1B7\0 B\0 }  \x1B7\b !\fC\vA\0!B\0! "! A.F\r\f \v A	j! -\0\x80AqE@ B\fB A-F"\x1B7\0 B\0 }  \x1B7\b !\fB\vA\0!B\0! "! A.F\r\f\v A\nj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\fA\vA\0!B\0! "! A.F\r\f\v A\vj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\f@\vA\0!B\0! "! A.F\r\f\v A\fj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\f?\vA\0!B\0! "! A.F\r\f\v A\rj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\f>\vA\0!B\0! "! A.F\r\f\x1B\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\f=\vA\0!B\0! "! A.F\r\f\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\f<\vA\0!B\0! "! A.F\r\f\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\f;\vA\0!B\0! "! A.F\r\f\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\f:\vA\0!B\0! "! A.F\r\f\v Aj! -\0\x80AqE@ B\0 }  A-F"\x1B7\b B\fB \x1B7\0 !\f9\vA\0!B\0! "! A.F\r\f\v@ A0kA\xFFqA	K\r\0 -\0-\0\x80Aq\r\0 B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCZ@ B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCR\r A5K\r\v Aj! \xAD B\n~|B0}! A-F@ B7\0  \xBA\x9A9\b\f9\v  7\b B7\0\f8\vA\0!B\0! A\xDFqA\xC5\0F@ "!A\0!\f\v A.G@ !A\0!\f\v -\0! Aj"! A0kA\xFFqA	K\r%\f\vA\0!B\0! "! A.G\r\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v A\x07j! -\0\x07"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v A\bj! -\0\b"\xADB\xFF\x83B0}"B	V@ !\f\r\v  B\n~|!\v A	j! -\0	"\xADB\xFF\x83B0}"B	V@ !\f\f\v  B\n~|!\v A\nj! -\0\n"\xADB\xFF\x83B0}"B	V@ !\f\v\v  B\n~|!\v A\vj! -\0\v"\xADB\xFF\x83B0}"B	V@ !\f\n\v  B\n~|!\v A\fj! -\0\f"\xADB\xFF\x83B0}"B	V@ !\f	\v  B\n~|!\v A\rj! -\0\r"\xADB\xFF\x83B0}"B	V@ !\f\b\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\x07\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v Aj!  B\n~|! "! -\0"A0kA\xFFqA\nO\r\v !@ "Aj! -\0"A0kA\xFFqA\nI\r\0\v  A\xFFqA4K\xAD|!@ @ ! !\f\v A\xFFqA.G@ !\f\v Aj! -\0A0kA\xFFqA	K\r@ "Aj! -\0\0"A0kA\xFFqA\nI\r\0\v\v  k\xAC  I\xAD|! !@@@ Ak"-\0\0A.k\0\0\v  K\r\v\vA\0   I"\x1B!A\0  \x1B! A\xDFqA\xC5\0F\r\f\v  AjF@ !\f\vB  k"\xAC}!A\0! A\xDFqA\xC5\0F@ !\f\v A\xD9H@ !\f\v B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7\b !\f"\v Aj -\0"-\0\x80Aqj"-\0\0"A0k"A\xFFqA	K\r@ A0F@@ "Aj! -\0"A0F\r\0\vB\0!\x07 ! A0k"A\xFFqA	K\r\vB\0!\x07 !@ \x07B\n~ \xADB\xFF\x83|!\x07 "Aj! -\0A0k"A\xFFqA\nI\r\0\v\v  kAN@ ! A-G\r B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7\b\f"\vB\0 \x07} \x07 A-F\x1B |! !\v B\xA8}W@ B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7\b !\f!\v ! B\xB4U\r\r\v  \xA7"6\xEC\b@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFFV\r\0 AjA,K\r\0 \xBA!%| A\0H@ %A\x80 Atk+\0\xA3\f\v At+\x80 %\xA2\v!% B7\0  %\x9A % A-F\x1B9\b\f \v P@ B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B7\b\f \v A\xEA\xA4\rlA\x80\x80\xFCkAu!\x7F@@@@ E A\xB2jA\xD2IqE@  y"\x86"\x07B\xFF\xFF\xFF\xFF\x83! \x07B \x88! At"A\xB8\xC0\0j)\0!\n A\xB0\xC0\0j)\0!	 \xA7!\f\v y"\xA7! At"A\xB0\xC0\0j)\0"	B\xFF\xFF\xFF\xFF\x83"\x07  \x86"\vB\xFF\xFF\xFF\xFF\x83"~"\fB \x88 	B \x88"\n ~|"\rB \x88 \n \vB \x88"~|  \x07~ \rB\xFF\xFF\xFF\xFF\x83|"\rB \x88|"\x07B\xFF\x83B}B\xFET\r A j A\xB8\xC0\0j)\0"\n \v\r \fB\xFF\xFF\xFF\xFF\x83 \rB \x86\x84"\v )(|"\fB}B}X\r\vB\0!\x07B\bB	BB\0 \x1B \x86"P\x1B | \nB?\x88 	|"B\xFF\xFF\xFF\xFF\x83"	 ~B \x88  B \x88"~|"B \x88  ~|  	~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\x88B\x83|"y"\x86!  \x86!A\xC0\0!A\v   \xA7jkA@k"A\xC2wJ\r A\x8FwI\rA\xCEw k! A\x91wM\r \f\v \x07 \v \fV\xAD|!\x07\v B7\0   k \x07B\0Y"kA\xC1\0A\xC0\0 \x07 \xAD\x86"B\x80\b\x83 |"B\x80\bT\x1BjA\xBE\bj\xADB4\x86 B\v\x88B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83\x84B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B\x847\b\f!\v A<k" j!  \xAD"\x88!  \x88B	|!A<\v!@  \xAD"\x88 B\x7F \x86B\x7F\x85\x83B\x86"B\b Ak\xAD\x86"	 |Z"\xAD|"P\r\0  j y"\n\xA7k"A\xC0\x07J\r\r  \n\x86B\v\x88! A\xC3wN@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83 A\xBE\bj\xADB4\x86\x84!\x07\f\v A\x8FwI\r\0 A\xC3w k\xAD\x88!\x07\v  	 }X\r \r A\xE0j  A\xEC\bj     \x07 \x07B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83B\x80\x80\x80\x80\x80\x80\x80\b\x84 \x07B\x80\x80\x80\x80\x80\x80\x80\bT"\x1BB\x86B\x847`A\xCDw \x07B4\x88\xA7A\xB4\bk \x1B! A\xE0\0j! (\xEC\b"A\0N@ (\xE0! AO@ A\xE8j!@ !A\0!@@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\vB\0!  O\r\0@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"B\x80\x80\xA0\xCF\b~"B \x88 B\x84\xC6\x9C\xD6\b~|"B\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"	7\0  	V\xAD B\x84\xC6\x9C\xD6\b~ B \x88| B \x88||! Aj" G\r\0\v P\r\0  Atj 7\0 Aj!\v Ak! A%J\r\0\v\v  6\xE0A! E\r AtA\x80\xE9\0j)\0! A\xE8j!A\0!@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\v  O\r B\xFF\xFF\xFF\xFF\x83! B \x88!B\0!@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" ~"	B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" ~|"\nB \x86 	B\xFF\xFF\xFF\xFF\x83\x84"	|"\v7\0 	 \vV\xAD  ~ B \x88| \nB \x88||! Aj" G\r\0\v P\r  Aj6\xE0  Atj 7\0\f\vA\0 k!A! AnO\r@ !A\0!@@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\vB\0!  O\r\0@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"B\x80\x80\xA0\xCF\b~"B \x88 B\x84\xC6\x9C\xD6\b~|"B\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"	7\0  	V\xAD B\x84\xC6\x9C\xD6\b~ B \x88| B \x88||! Aj" G\r\0\v P\r\0  Atj 7\0 Aj!\v Ak! A%J\r\0\v  6X E@ !\f\vA\0! E\r\f\v@ A\xDD\0k\x1B\0\v A"G\r  Aj"M@ \x1BAv \x1Bj"\x1BA\xFE\xFF\xFF\xFF\0K@ !\0\f)\v  \x1BAt""E@ !\0\f)\v   kj!   kj! " jA k!\v  Aj!  Aj"!@@@\x7F  -\0\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 A\x07j -\0\x07"-\0\x80AqE\r\0 A\bj -\0\b"-\0\x80AqE\r\0 A	j -\0	"-\0\x80AqE\r\0 A\nj -\0\n"-\0\x80AqE\r\0 A\vj -\0\v"-\0\x80AqE\r\0 A\fj -\0\f"-\0\x80AqE\r\0 A\rj -\0\r"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 -\0"-\0\x80Aq\r Aj\v!B\r!\x07 A"F@ !\f!\v \xC0A\0H\rB!\x07 !@ A\xFFq"A\xDC\0G@ A"G\r\f"\v\x7F@@@@@@@@@@ -\0A"kT\0\x07\b\v A":\0\0\f\b\v A\xDC\0:\0\0\f\x07\v A/:\0\0\f\v A\b:\0\0\f\v A\f:\0\0\f\v A\n:\0\0\f\v A\r:\0\0\f\v A	:\0\0\f\v -\0-\0\x80 -\0-\0\x80A\btr" -\0-\0\x80 -\0-\0\x80A\btr"rA\xF0\xE1q\r Aj!  Atr"A\x80\xF0qA\x80\xB0G@ A\xFF\xFFq"A\x80O@  A?qA\x80r:\0  AvA?qA\x80r:\0  A\x80\xE0qA\fvA\xE0r:\0\0 Aj\f\v A\x80O@  A?qA\x80r:\0  AvA\xC0r:\0\0 Aj\f\v  :\0\0 Aj\f\v A\x80\xB8qA\x80\xB0G\r /\0\0A\xDC\xEAG\r -\0\v-\0\x80 -\0	-\0\x80A\btr" -\0\n-\0\x80 -\0\b-\0\x80A\btr"rA\xF0\xE1q\r  Atr"A\x80\xF8qA\x80\xB8G\r  A?qA\x80r:\0  A\xFF\xBFq A\ntA\x80\xF8\xBF\x1Bqj"A\x80\xB8\xFFk"AvA\xF0r:\0\0  AvAjA?qA\x80r:\0  A\fvA?qA\x80r:\0 A\fj! Aj\f\v Aj! Aj\v!@@ -\0\0"-\0\x80AqE@ !\f\v\x7F@@@@@@@@@@@@@ -\0-\0\x80Aq@ -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0\x07-\0\x80AqE\r -\0\b-\0\x80AqE\r\x07 -\0	-\0\x80AqE\r\b -\0\n-\0\x80AqE\r	 -\0\v-\0\x80AqE\r\n -\0\f-\0\x80AqE\r\v -\0\r-\0\x80AqE\r\f -\0-\0\x80AqE\r\r -\0 )\0\0!  )\0\b7\0\b  7\0\0-\0\x80AqE@A! Aj\f\v Aj! Aj!\f\v  /\0\0;\0\0A! Aj\f\r\v  /\0\0;\0\0A! Aj\f\f\v  (\0\x006\0\0A! Aj\f\v\v  (\0\x006\0\0A! Aj\f\n\v  (\0\x006\0\0  /\0;\0A! Aj\f	\v  (\0\x006\0\0  /\0;\0A! Aj\f\b\v  )\0\x007\0\0A\x07! A\x07j\f\x07\v  )\0\x007\0\0A\b! A\bj\f\v  )\0\x007\0\0  /\0\b;\0\bA	! A	j\f\v  )\0\x007\0\0  /\0\b;\0\bA\n! A\nj\f\v  )\0\x007\0\0  (\0\b6\0\bA\v! A\vj\f\v  )\0\x007\0\0  (\0\b6\0\bA\f! A\fj\f\v  )\0\x007\0\0  (\0\b6\0\b  /\0\f;\0\fA\r! A\rj\f\v  )\0\x007\0\0  (\0\b6\0\b  /\0\f;\0\fA! Aj\v!  j! -\0\0!\v \xC0A\0N\r "!@ (\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ !\f\v A\x8D\xC0\0F@ !\f\v  6\0\0 Aj! (\0! Aj"! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 ! AqE\r\0@  ;\0\0 Aj! Aj! (\0"A\xE0\x81qA\xC0\x81G\r ! Aq\r\0\v\v@ A\x87\xE0\0qE\r\0 A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0@ AqE@ !\f\v ! A\x83\xE0\0q\r\v@  6\0\0 Aj! Aj! (\0"A\x87\xE0\0qE\r A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r ! AqE\r\0 A\x83\xE0\0qE\r\0\v\v  G\r\0\v\v !\f\v Aj!\f\v@ ""(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ !\f\v A\x8D\xC0\0F@ !\f\v (\0! Aj"! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 ! AqE\r\0@ Aj! (\0"A\xE0\x81qA\xC0\x81G\r ! Aq\r\0\v\v@ A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0 ! A\x87\xE0\0qE\r\0@@ AqE\r\0 A\x83\xE0\0qE\r\0 !\f\v Aj! (\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r ! A\x87\xE0\0q\r\0\v\v  G\r\0\v\f\v A6X\v AtA\x80\xE9\0j)\0!A\0!@@  Atj)\0B\0R\r Aj" G\r\0\v !\f\v  O@ !\f\v B\xFF\xFF\xFF\xFF\x83! B \x88!B\0!@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" ~"	B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" ~|"\nB \x86 	B\xFF\xFF\xFF\xFF\x83\x84"	|"\v7\0 	 \vV\xAD  ~ B \x88| \nB \x88||! Aj" G\r\0\v P@ !\f\v  Atj 7\0 Aj!\v@@@ A\0J@ Av! A?q"E@@ E\r\0 "Aq"@A\0!@ A\xD8\0j Atj" Atj )\x007\0 Ak! Aj" G\r\0\v\v AI\r\0@ A\xD8\0j Atj" At"j )\x007\0 A\bk" j )\x007\0 Ak" j )\x007\0 Ak" j )\x007\0 Ak"\r\0\v\v   j"6X\f\v  Atj"B\x007\0 \xAD!@ E\r\0A\xC0\0 k\xAD! "Aq@  Atj A\xD8\0j Atj)\0 \x887\0 Ak!\v AF\r\0 At" A\xD8\0jj!@  At"j"" j ")\0 \x86 A\xD8\0j j"")\0" \x88\x847\0  j  \x86 "A\bk)\0 \x88\x847\0 Ak"\r\0\v\v  At"j )` \x867\0  j  j)\0B\0Rj! \r\f\vA\0 k"Av! (\xE0! A?q"E@@ E\r\0 "Aq"@A\0!@ A\xE0j Atj" Atj )\x007\0 Ak! Aj" G\r\0\v\v AI\r\0@ A\xE0j Atj" At"j )\x007\0 A\bk" j )\x007\0 Ak" j )\x007\0 Ak" j )\x007\0 Ak"\r\0\v\v   j"6\xE0 E\r A\xE8j!\f\v A\xE8j" Atj"B\x007\0 \xAD!@ E\r\0A\xC0\0 k\xAD! "Aq@  Atj A\xE0j Atj)\0 \x887\0 Ak!\v AF\r\0 At" A\xE0jj!"@  At"j"# j #)\0 \x86 A\xE0j j"#)\0" \x88\x847\0  "j  \x86 #A\bk)\0 \x88\x847\0 Ak"\r\0\v\v  At"j )\xE8 \x867\0   j  j)\0B\0Rj"6\xE0 E\r\v At"E\r\0 A\0 \xFC\v\0\v (\xE0!\vA\x7F!~@@  I\r\0A!  K\r\0 E\r@@A\x7FA  At" A\xE0jj)\0" A\xD8\0j j)\0"V\x1B  T\x1B!  R\r\0 Ak"\r\f\v\v E\r\v A\0J\xAD\f\v \x07B\x83\v \x07|"\x07B\x80\x80\x80\x80\x80\x80\x80\xF8\xFF\0Q\r\b\v B7\0  \x07B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A-F\x1B\x847\b\f\v AqE\r@ "Aj! -\0-\0\x80Aq\r\0\v\f\0\v\0\v@@@ \0/\0\0"A\xA0\xC0\0G\r\0@@@@@@@@@@@@@@@@ \0/\0"A\xA0\xC0\0G\r \0/\0"A\xA0\xC0\0G\r \0/\0"A\xA0\xC0\0G\r\r \0/\0\b"A\xA0\xC0\0G\r\f \0/\0\n"A\xA0\xC0\0G\r\v \0/\0\f"A\xA0\xC0\0G\r\n \0/\0"A\xA0\xC0\0G\r	 \0/\0"A\xA0\xC0\0G\r\b \0/\0"A\xA0\xC0\0G\r\x07 \0/\0"A\xA0\xC0\0G\r \0/\0"A\xA0\xC0\0G\r \0/\0"A\xA0\xC0\0G\r \0/\0"A\xA0\xC0\0G\r \0/\0"A\xA0\xC0\0G\r \0/\0"A\xA0\xC0\0G\r \0/\0 ! \0A j!\0 A\xA0\xC0\0F\r\0\v\f\v \0Aj!\0\f\v \0Aj!\0\f\r\v \0Aj!\0\f\f\v \0Aj!\0\f\v\v \0Aj!\0\f\n\v \0Aj!\0\f	\v \0Aj!\0\f\b\v \0Aj!\0\f\x07\v \0Aj!\0\f\v \0A\fj!\0\f\v \0A\nj!\0\f\v \0A\bj!\0\f\v \0Aj!\0\f\v \0Aj!\0\f\v \0Aj!\0\v@@ A\xFFq"A"G@ A\xFD\0G\r \0Aj!B\x07!  E\r\f\v  Aj"M@ \x1BAv \x1Bj"\x1BA\xFE\xFF\xFF\xFF\0K\r%  \x1BAt""E\r%   kj!   kj! " jA k!\v \0Aj"!@@@\x7F  -\0\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 A\x07j -\0\x07"-\0\x80AqE\r\0 A\bj -\0\b"-\0\x80AqE\r\0 A	j -\0	"-\0\x80AqE\r\0 A\nj -\0\n"-\0\x80AqE\r\0 A\vj -\0\v"-\0\x80AqE\r\0 A\fj -\0\f"-\0\x80AqE\r\0 A\rj -\0\r"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 -\0"-\0\x80Aq\r Aj\v!B\r!\x07 A"F@ !\f\x07\v \xC0A\0H\rB!\x07 !@ A\xFFq"A\xDC\0G@ A"G\r\f\b\v\x7F@@@@@@@@@@ -\0A"kT\0\x07\b\v A":\0\0\f\b\v A\xDC\0:\0\0\f\x07\v A/:\0\0\f\v A\b:\0\0\f\v A\f:\0\0\f\v A\n:\0\0\f\v A\r:\0\0\f\v A	:\0\0\f\v -\0-\0\x80 -\0-\0\x80A\btr" -\0-\0\x80 -\0-\0\x80A\btr"rA\xF0\xE1q\r Aj!  Atr"A\x80\xF0qA\x80\xB0G@ A\xFF\xFFq"A\x80O@  A?qA\x80r:\0  AvA?qA\x80r:\0  A\x80\xE0qA\fvA\xE0r:\0\0 Aj\f\v A\x80O@  A?qA\x80r:\0  AvA\xC0r:\0\0 Aj\f\v  :\0\0 Aj\f\v A\x80\xB8qA\x80\xB0G\r /\0\0A\xDC\xEAG\r -\0\v-\0\x80 -\0	-\0\x80A\btr" -\0\n-\0\x80 -\0\b-\0\x80A\btr"rA\xF0\xE1q\r  Atr"A\x80\xF8qA\x80\xB8G\r  A?qA\x80r:\0  A\xFF\xBFq A\ntA\x80\xF8\xBF\x1Bqj"A\x80\xB8\xFFk"AvA\xF0r:\0\0  AvAjA?qA\x80r:\0  A\fvA?qA\x80r:\0 A\fj! Aj\f\v Aj! Aj\v!@@ -\0\0"-\0\x80AqE@ !\f\v\x7F@@@@@@@@@@@@@ -\0-\0\x80Aq@ -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0\x07-\0\x80AqE\r -\0\b-\0\x80AqE\r\x07 -\0	-\0\x80AqE\r\b -\0\n-\0\x80AqE\r	 -\0\v-\0\x80AqE\r\n -\0\f-\0\x80AqE\r\v -\0\r-\0\x80AqE\r\f -\0-\0\x80AqE\r\r -\0 )\0\0!  )\0\b7\0\b  7\0\0-\0\x80AqE@A! Aj\f\v Aj! Aj!\f\v  /\0\0;\0\0A! Aj\f\r\v  /\0\0;\0\0A! Aj\f\f\v  (\0\x006\0\0A! Aj\f\v\v  (\0\x006\0\0A! Aj\f\n\v  (\0\x006\0\0  /\0;\0A! Aj\f	\v  (\0\x006\0\0  /\0;\0A! Aj\f\b\v  )\0\x007\0\0A\x07! A\x07j\f\x07\v  )\0\x007\0\0A\b! A\bj\f\v  )\0\x007\0\0  /\0\b;\0\bA	! A	j\f\v  )\0\x007\0\0  /\0\b;\0\bA\n! A\nj\f\v  )\0\x007\0\0  (\0\b6\0\bA\v! A\vj\f\v  )\0\x007\0\0  (\0\b6\0\bA\f! A\fj\f\v  )\0\x007\0\0  (\0\b6\0\b  /\0\f;\0\fA\r! A\rj\f\v  )\0\x007\0\0  (\0\b6\0\b  /\0\f;\0\fA! Aj\v!  j! -\0\0!\v \xC0A\0N\r@ ""(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ !\f\v A\x8D\xC0\0F@ !\f\v  6\0\0 Aj! (\0! Aj"! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 ! AqE\r\0@  ;\0\0 Aj! Aj! (\0"A\xE0\x81qA\xC0\x81G\r ! Aq\r\0\v\v@ A\x87\xE0\0qE\r\0 A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0@ AqE@ !\f\v ! A\x83\xE0\0q\r\v@  6\0\0 Aj! Aj! (\0"A\x87\xE0\0qE\r A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r ! AqE\r\0 A\x83\xE0\0qE\r\0\v\v  G\r\0\v\v !\f\v Aj!\f\v@ ""(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ !\f\v A\x8D\xC0\0F@ !\f\v (\0! Aj"! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 ! AqE\r\0@ Aj! (\0"A\xE0\x81qA\xC0\x81G\r ! Aq\r\0\v\v@ A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0 ! A\x87\xE0\0qE\r\0@@ AqE\r\0 A\x83\xE0\0qE\r\0 !\f\v Aj! (\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r ! A\x87\xE0\0q\r\0\v\v  G\r\0\v\f\r\vA\f\x1B\v -\0\x80Aq@@ \0"Aj!\0 -\0-\0\x80Aq\r\0\f\v\0\v\v AA \0 A\x1B6\xE0\f"\v  6\b   k\xACB\b\x86 \x07\x847\0 A\0:\0\0  Aj!@\x7F /\0"A\xBA\xC0\0G@ Aj!@ Aj A\xFFq"A:F\r -\0\x80AqE\r@ "Aj! -\0-\0\x80Aq\r\0\v /\0\0"A\xBA\xC0\0G\r\0\v\v Aj\v"-\0\0"A"F\r\b -\0\x80!@ Aq@ A\x006\xEC\b  Aj!  Aj!@@@@@@@@@@@@@@@@@@@@@@@  A\xFFqA-F"j"-\0\0"A1kA\xFFqA	O@ A0G\r  Aj! -\0"-\0\x80AqE@ B\x007 B\fB \x1B7 !\f$\v@ A.F@ Aj! -\0"A0kA\xFFqA	K@ !\f#\v A\xFFqA0F@@ "Aj! -\0"A0F\r\0\v A0kA\xFFqA	K\r\v Ak! \xADB\xFF\x83B0}!\f\v ! A0kA\xFFqA\nI\r!\v A\xDFqA\xC5\0F@ AA -\0-\0\x80Aq\x1Bj"-\0\0A0kA\xFFqA	K@ !\f"\v@ "Aj! -\0A0kA\xFFqA\nI\r\0\v\v B7 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7\f#\v \xADB\xFF\x83"B0}!@@@@@@@@@@@@@@@@@@@ -\0"\xADB0}"\x07B	X@ \x07 B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0\x07"\xADB0}"B	V\r  B\n~|! -\0\b"\xADB0}"B	V\r\x07  B\n~|! -\0	"\xADB0}"B	V\r\b  B\n~|! -\0\n"\xADB0}"B	V\r	  B\n~|! -\0\v"\xADB0}"B	V\r\n  B\n~|! -\0\f"\xADB0}"B	V\r\v  B\n~|! -\0\r"\xADB0}"B	V\r\f  B\n~|! -\0"\xADB0}"B	V\r\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r  B\n~|! -\0"\xADB0}"B	V\r Aj!  B\n~|! -\0"-\0\x80Aq\r@ A\xFFq"A-G\r\0 B\x81\x80\x80\x80\x80\x80\x80\x80\x80\x7FT\r\0 B7  \xBA\x9A9\f7\v B\0 }  A-F"\x1B7 B\fB \x1B7\f6\v Aj! -\0\x80Aq\r B0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f5\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f5\vA\0!B\0! "! A.F\r\f&\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f4\vA\0!B\0! "! A.F\r\f%\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f3\vA\0!B\0! "! A.F\r\f$\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f2\vA\0!B\0! "! A.F\r\f#\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f1\vA\0!B\0! "! A.F\r\f"\v A\x07j! -\0\x80AqE@ B\fB A\xFFqA-F"\x1B7\0 B\0 }  \x1B7 !\f0\vA\0!B\0! "! A.F\r\f!\v A\bj! -\0\x80AqE@ B\fB A\xFFqA-F"\x1B7\0 B\0 }  \x1B7 !\f/\vA\0!B\0! "! A.F\r\f \v A	j! -\0\x80AqE@ B\fB A\xFFqA-F"\x1B7\0 B\0 }  \x1B7 !\f.\vA\0!B\0! "! A.F\r\f\v A\nj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f-\vA\0!B\0! "! A.F\r\f\v A\vj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f,\vA\0!B\0! "! A.F\r\f\v A\fj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f+\vA\0!B\0! "! A.F\r\f\v A\rj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f*\vA\0!B\0! "! A.F\r\f\x1B\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f)\vA\0!B\0! "! A.F\r\f\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f(\vA\0!B\0! "! A.F\r\f\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f\'\vA\0!B\0! "! A.F\r\f\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f&\vA\0!B\0! "! A.F\r\f\v Aj! -\0\x80AqE@ B\0 }  A\xFFqA-F"\x1B7 B\fB \x1B7 !\f%\vA\0!B\0! "! A.F\r\f\v@ A0kA\xFFqA	K\r\0 -\0-\0\x80Aq\r\0 B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCZ@ B\x99\xB3\xE6\xCC\x99\xB3\xE6\xCCR\r A5K\r\v Aj! \xAD B\n~|B0}! A\xFFqA-F@ B7  \xBA\x9A9\f%\v  7 B7\f$\vA\0!B\0! A\xDFqA\xC5\0F@ "!A\0!\f\v A.G@ !A\0!\f\v -\0! Aj"! A0kA\xFFqA	K\r \f\vA\0!B\0! "! A.G\r\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v A\x07j! -\0\x07"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v A\bj! -\0\b"\xADB\xFF\x83B0}"B	V@ !\f\r\v  B\n~|!\v A	j! -\0	"\xADB\xFF\x83B0}"B	V@ !\f\f\v  B\n~|!\v A\nj! -\0\n"\xADB\xFF\x83B0}"B	V@ !\f\v\v  B\n~|!\v A\vj! -\0\v"\xADB\xFF\x83B0}"B	V@ !\f\n\v  B\n~|!\v A\fj! -\0\f"\xADB\xFF\x83B0}"B	V@ !\f	\v  B\n~|!\v A\rj! -\0\r"\xADB\xFF\x83B0}"B	V@ !\f\b\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\x07\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v  B\n~|!\v Aj! -\0"\xADB\xFF\x83B0}"B	V@ !\f\v Aj!  B\n~|! "! -\0"A0kA\xFFqA\nO\r\v !@ "Aj! -\0"A0kA\xFFqA\nI\r\0\v  A\xFFqA4K\xAD|!@ @ ! !\f\v A\xFFqA.G@ !\f\v Aj! -\0A0kA\xFFqA	K\r\r@ "Aj! -\0\0"A0kA\xFFqA\nI\r\0\v\v  k\xAC  I\xAD|! !@@@ Ak"-\0\0A.k\0\0\v  K\r\v\vA\0   I"\x1B!A\0  \x1B! A\xDFqA\xC5\0F\r\f\v  AjF@ !\f\f\vB  k"\xAC}!A\0! A\xDFqA\xC5\0F@ !\f\v A\xD9H@ !\f\v B7 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7 !\f\v Aj -\0"-\0\x80Aqj"-\0\0"A0k"A\xFFqA	K\r\n@ A0F@@ "Aj! -\0"A0F\r\0\vB\0!\x07 ! A0k"A\xFFqA	K\r\vB\0!\x07 !@ \x07B\n~ \xADB\xFF\x83|!\x07 "Aj! -\0A0k"A\xFFqA\nI\r\0\v\v  kAN@ ! A-G\r\v B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7\f\vB\0 \x07} \x07 A-F\x1B |! !\v B\xA8}W@ B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7 !\f\r\v ! B\xB4U\r\b\v  \xA7"6\xEC\b@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFFV\r\0 AjA,K\r\0 \xBA!%| A\0H@ %A\x80 Atk+\0\xA3\f\v At+\x80 %\xA2\v!% B7  %\x9A % A\xFFqA-F\x1B9\f\f\v P@ B7\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B7\f\f\v A\xEA\xA4\rlA\x80\x80\xFCkAu!\x7F@@@@ E A\xB2jA\xD2IqE@  y"\x86"\x07B\xFF\xFF\xFF\xFF\x83! \x07B \x88! At"A\xB8\xC0\0j)\0!\n A\xB0\xC0\0j)\0!	 \xA7!\f\v y"\xA7! At"A\xB0\xC0\0j)\0"	B\xFF\xFF\xFF\xFF\x83"\x07  \x86"\vB\xFF\xFF\xFF\xFF\x83"~"\fB \x88 	B \x88"\n ~|"\rB \x88 \n \vB \x88"~|  \x07~ \rB\xFF\xFF\xFF\xFF\x83|"\rB \x88|"\x07B\xFF\x83B}B\xFET\r A0j A\xB8\xC0\0j)\0"\n \v\r \fB\xFF\xFF\xFF\xFF\x83 \rB \x86\x84"\v )8|"\fB}B}X\r\vB\0!\x07B\bB	BB\0 \x1B \x86"P\x1B | \nB?\x88 	|"B\xFF\xFF\xFF\xFF\x83"	 ~B \x88  B \x88"~|"B \x88  ~|  	~ B\xFF\xFF\xFF\xFF\x83|"B \x88| B\x88B\x83|"y"\x86!  \x86!A\xC0\0!A\v   \xA7jkA@k"A\xC2wJ\r A\x8FwI\rA\xCEw k! A\x91wM\r \f\v \x07 \v \fV\xAD|!\x07\v B7   k \x07B\0Y"kA\xC1\0A\xC0\0 \x07 \xAD\x86"B\x80\b\x83 |"B\x80\bT\x1BjA\xBE\bj\xADB4\x86 B\v\x88B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83\x84B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B\x847\f\r\v A<k" j!  \xAD"\x88!  \x88B	|!A<\v!@  \xAD"\x88 B\x7F \x86B\x7F\x85\x83B\x86"B\b Ak\xAD\x86"	 |Z"\xAD|"P\r\0  j y"\n\xA7k"A\xC0\x07J\r\b  \n\x86B\v\x88! A\xC3wN@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83 A\xBE\bj\xADB4\x86\x84!\x07\f\v A\x8FwI\r\0 A\xC3w k\xAD\x88!\x07\v  	 }X\r	 \r	 A\xE0j  A\xEC\bj     \x07 \x07B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07\x83B\x80\x80\x80\x80\x80\x80\x80\b\x84 \x07B\x80\x80\x80\x80\x80\x80\x80\bT"\x1BB\x86B\x847`A\xCDw \x07B4\x88\xA7A\xB4\bk \x1B! A\xE0\0j! (\xEC\b"A\0N@ (\xE0! AO@ A\xE8j!@ !A\0!@@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\vB\0!  M\r\0@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"B\x80\x80\xA0\xCF\b~"B \x88 B\x84\xC6\x9C\xD6\b~|"B\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"	7\0  	V\xAD B\x84\xC6\x9C\xD6\b~ B \x88| B \x88||! Aj" G\r\0\v P\r\0  Atj 7\0 Aj!\v Ak! A%J\r\0\v\v  6\xE0A! E\r\x07 AtA\x80\xE9\0j)\0! A\xE8j!A\0!@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\b\v  M\r\x07 B\xFF\xFF\xFF\xFF\x83! B \x88!B\0!@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" ~"	B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" ~|"\nB \x86 	B\xFF\xFF\xFF\xFF\x83\x84"	|"\v7\0 	 \vV\xAD  ~ B \x88| \nB \x88||! Aj" G\r\0\v P\r\x07  Aj6\xE0  Atj 7\0\f\x07\vA\0 k!A! AnO\r@ !A\0!@@ E\r\0@  Atj)\0B\0R\r Aj" G\r\0\v\f\vB\0!  M\r\0@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83"B\x80\x80\xA0\xCF\b~"B \x88 B\x84\xC6\x9C\xD6\b~|"B\xFF\xFF\xFF\xFF\x83 B \x88"B\x80\x80\xA0\xCF\b~|"B \x86 B\x80\x80\xE0\xFF\x83\x84"|"	7\0  	V\xAD B\x84\xC6\x9C\xD6\b~ B \x88| B \x88||! Aj" G\r\0\v P\r\0  Atj 7\0 Aj!\v Ak! A%J\r\0\v  6X E@ !\f\x07\vA\0! E\r\f\v@@@@ A\xFFqA\xDB\0k!!\0\v (\0\0A\xF4\xE4\xD5\xABG\r B\v7 Aj! Aj!  Aj! \f\r\v (\0A\xE1\xD8\xCD\xABG\r B7 Aj! Aj!  Aj! \f\f\v (\0\0A\xEE\xEA\xB1\xE3G\r B7 Aj! Aj!  Aj! \f\v\v AqE\r@ "Aj! -\0"-\0\x80"Aq\r\0\v A"G\r\0\v\f\b\v AA  A\x1B6\xE0\f!\v AA  A\x1B6\xE0\f \v A6X\v AtA\x80\xE9\0j)\0!A\0!@@  Atj)\0B\0R\r Aj" G\r\0\v !\f\v  M@ !\f\v B\xFF\xFF\xFF\xFF\x83! B \x88!B\0!@  Atj"  )\0"B\xFF\xFF\xFF\xFF\x83" ~"	B \x88  ~|"B\xFF\xFF\xFF\xFF\x83 B \x88" ~|"\nB \x86 	B\xFF\xFF\xFF\xFF\x83\x84"	|"\v7\0 	 \vV\xAD  ~ B \x88| \nB \x88||! Aj" G\r\0\v P@ !\f\v  Atj 7\0 Aj!\v@@@ A\0J@ Av! A?q"E@@ E\r\0 "Aq"@A\0!@ A\xD8\0j Atj" Atj )\x007\0 Ak! Aj" G\r\0\v\v AI\r\0@ A\xD8\0j Atj" At"j )\x007\0 A\bk" j )\x007\0 Ak" j )\x007\0 Ak" j )\x007\0 Ak"\r\0\v\v   j"6X\f\v  Atj"B\x007\0 \xAD!@ E\r\0A\xC0\0 k\xAD! "Aq@  Atj A\xD8\0j Atj)\0 \x887\0 Ak!\v AF\r\0 At" A\xD8\0jj!"@  At"j"# j #)\0 \x86 A\xD8\0j j"#)\0" \x88\x847\0  "j  \x86 #A\bk)\0 \x88\x847\0 Ak"\r\0\v\v  At"j )` \x867\0  j  j)\0B\0Rj! \r\f\vA\0 k"Av! (\xE0! A?q"E@@ E\r\0 "Aq"@A\0!@ A\xE0j Atj" Atj )\x007\0 Ak! Aj" G\r\0\v\v AI\r\0@ A\xE0j Atj" At"j )\x007\0 A\bk" j )\x007\0 Ak" j )\x007\0 Ak" j )\x007\0 Ak"\r\0\v\v   j"6\xE0 E\r A\xE8j!\f\v A\xE8j" Atj"B\x007\0 \xAD!@ E\r\0A\xC0\0 k\xAD! "Aq@  Atj A\xE0j Atj)\0 \x887\0 Ak!\v AF\r\0 At"" A\xE0jj!#@  At"j"$ "j $)\0 \x86 A\xE0j j"$)\0" \x88\x847\0  #j  \x86 $A\bk)\0 \x88\x847\0 Ak"\r\0\v\v  At"j )\xE8 \x867\0   j  j)\0B\0Rj"6\xE0 E\r\v At"E\r\0 A\0 \xFC\v\0\v (\xE0!\vA\x7F!~@@  I\r\0A!  K\r\0 E\r@@A\x7FA  At" A\xE0jj)\0" A\xD8\0j j)\0"V\x1B  T\x1B!  R\r\0 Ak"\r\f\v\v E\r\v A\0J\xAD\f\v \x07B\x83\v \x07|"\x07B\x80\x80\x80\x80\x80\x80\x80\xF8\xFF\0R\r\v !\v AA	  A	\x1B6\xE0\f\x1B\v B7  \x07B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7FB\0 A\xFFqA-F\x1B\x847\f\v  Aj!  Aj! Aj"!@@@@\x7F  -\0\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 A\x07j -\0\x07"-\0\x80AqE\r\0 A\bj -\0\b"-\0\x80AqE\r\0 A	j -\0	"-\0\x80AqE\r\0 A\nj -\0\n"-\0\x80AqE\r\0 A\vj -\0\v"-\0\x80AqE\r\0 A\fj -\0\f"-\0\x80AqE\r\0 A\rj -\0\r"-\0\x80AqE\r\0 Aj -\0"-\0\x80AqE\r\0 -\0"-\0\x80Aq\r Aj\v!B\r!\x07 A"F@ !\f\v \xC0A\0H\rB!\x07 !@ A\xFFq"A\xDC\0G@ A"G\r\x07\f\v\x7F@@@@@@@@@@ -\0A"kT\0\x07\b\v A":\0\0\f\b\v A\xDC\0:\0\0\f\x07\v A/:\0\0\f\v A\b:\0\0\f\v A\f:\0\0\f\v A\n:\0\0\f\v A\r:\0\0\f\v A	:\0\0\f\v -\0-\0\x80 -\0-\0\x80A\btr" -\0-\0\x80 -\0-\0\x80A\btr"rA\xF0\xE1q\r\b Aj!  Atr"A\x80\xF0qA\x80\xB0G@ A\xFF\xFFq"A\x80O@  A?qA\x80r:\0  AvA?qA\x80r:\0  A\x80\xE0qA\fvA\xE0r:\0\0 Aj\f\v A\x80O@  A?qA\x80r:\0  AvA\xC0r:\0\0 Aj\f\v  :\0\0 Aj\f\v A\x80\xB8qA\x80\xB0G\r\b /\0\0A\xDC\xEAG\r\b -\0\v-\0\x80 -\0	-\0\x80A\btr" -\0\n-\0\x80 -\0\b-\0\x80A\btr"rA\xF0\xE1q\r\b  Atr"A\x80\xF8qA\x80\xB8G\r\b  A?qA\x80r:\0  A\xFF\xBFq A\ntA\x80\xF8\xBF\x1Bqj"A\x80\xB8\xFFk"AvA\xF0r:\0\0  AvAjA?qA\x80r:\0  A\fvA?qA\x80r:\0 A\fj! Aj\f\v Aj! Aj\v!@@ -\0\0"-\0\x80AqE@ !\f\v\x7F@@@@@@@@@@@@@ -\0-\0\x80Aq@ -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0-\0\x80AqE\r -\0\x07-\0\x80AqE\r -\0\b-\0\x80AqE\r\x07 -\0	-\0\x80AqE\r\b -\0\n-\0\x80AqE\r	 -\0\v-\0\x80AqE\r\n -\0\f-\0\x80AqE\r\v -\0\r-\0\x80AqE\r\f -\0-\0\x80AqE\r\r -\0 )\0\0!  )\0\b7\0\b  7\0\0-\0\x80AqE@A! Aj\f\v Aj! Aj!\f\v  /\0\0;\0\0A! Aj\f\r\v  /\0\0;\0\0A! Aj\f\f\v  (\0\x006\0\0A! Aj\f\v\v  (\0\x006\0\0A! Aj\f\n\v  (\0\x006\0\0  /\0;\0A! Aj\f	\v  (\0\x006\0\0  /\0;\0A! Aj\f\b\v  )\0\x007\0\0A\x07! A\x07j\f\x07\v  )\0\x007\0\0A\b! A\bj\f\v  )\0\x007\0\0  /\0\b;\0\bA	! A	j\f\v  )\0\x007\0\0  /\0\b;\0\bA\n! A\nj\f\v  )\0\x007\0\0  (\0\b6\0\bA\v! A\vj\f\v  )\0\x007\0\0  (\0\b6\0\bA\f! A\fj\f\v  )\0\x007\0\0  (\0\b6\0\b  /\0\f;\0\fA\r! A\rj\f\v  )\0\x007\0\0  (\0\b6\0\b  /\0\f;\0\fA! Aj\v!  j! -\0\0!\v \xC0A\0N\r "!@ (\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ !\f\v A\x8D\xC0\0F@ !\f\v  6\0\0 Aj! (\0! Aj"! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r\0@ A\xE0\x81qA\xC0\x81G\r\0 ! AqE\r\0@  ;\0\0 Aj! Aj! (\0"A\xE0\x81qA\xC0\x81G\r ! Aq\r\0\v\v@ A\x87\xE0\0qE\r\0 A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0@ AqE@ !\f\v ! A\x83\xE0\0q\r\v@  6\0\0 Aj! Aj! (\0"A\x87\xE0\0qE\r A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r ! AqE\r\0 A\x83\xE0\0qE\r\0\v\v  G\r\0\v\v !\f\v Aj!\f\v@ ""(\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r\0@ A\x8F\xC0\0q"E@ !\f\v A\x8D\xC0\0F@ !\f\v (\0! Aj"! A\xF0\x81\x83qA\xE0\x81\x82F\r\0\v\v A\x80qE\r@ A\xE0\x81qA\xC0\x81G\r\0 ! AqE\r\0@ Aj! (\0"A\xE0\x81qA\xC0\x81G\r ! Aq\r\0\v\v@ A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\0 ! A\x87\xE0\0qE\r\0@@ AqE\r\0 A\x83\xE0\0qE\r\0 !\f\v Aj! (\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r ! A\x87\xE0\0q\r\0\v\v  G\r\f\v\v  6   k\xACB\b\x86 \x07\x847 A\0:\0\0 Aj!\vA\f\v AA\n  A\n\x1B6\xE0\f\v Aj!B!\b  E\r\v@ Ak"-\0\0A,G\r\0\v AA\x07  A\x07\x1B6\xE0\f\vA\f\v\v@  Aj"K@ !\f\v \x1BAv \x1Bj"\x1BA\xFE\xFF\xFF\xFF\0K@ !\0\f\v  \x1BAt""E@ !\0\f\v   kj!   kj!  jA k!\v (\0\0A\xEE\xEA\xB1\xE3F\r !\v AA\v  A\v\x1B6\xE0\f\v B7\0 Aj!  Aj!  !\f\x07\v@  Aj"K@ !\f\v \x1BAv \x1Bj"\x1BA\xFE\xFF\xFF\xFF\0K@ !\0\f\v  \x1BAt""E@ !\0\f\v   kj!   kj!  jA k!\v (\0A\xE1\xD8\xCD\xABF\r !\v AA\v  A\v\x1B6\xE0\f\v B7\0 Aj!  Aj!  !\f\v@  Aj"K@ !\f\v \x1BAv \x1Bj"\x1BA\xFE\xFF\xFF\xFF\0K@ !\0\f\v  \x1BAt""E@ !\0\f\v   kj!   kj!  jA k!\v (\0\0A\xF4\xE4\xD5\xABF\r !\v AA\v  A\v\x1B6\xE0\f\f\v B\v7\0 Aj!  Aj!  !\f\v  6\b   k\xACB\b\x86 \x07\x847\0 A\0:\0\0 Aj!\vA\0\v!@@@@@@@@@@@@ \0\b\v@ /\0\0"A\xACG@@ A\xFFq"A\xDD\0F\r A,F@ Aj!\f	\v -\0\x80AqE\r@ "Aj! -\0-\0\x80Aq\r\0\v /\0\0"A\xACG\r\0\v\v Aj!\f\v Aj!  A\btAr\xAD!\bA!\f\n\v  \b7\0 (\b!   kAj6\b E\r\x07\f\b\v /\0\0"A\xACG@@ A\xFFq"A,F\r A\xFD\0F@ Aj!  A\x07tA\x07r\xAD!A!\f\v\v -\0\x80AqE\r@ "Aj! -\0-\0\x80Aq\r\0\v /\0\0"A\xACG\r\0\v\v Aj!\0\f\v AA  A\x1B6\xE0\f\v AA  A\x1B6\xE0\f\v Aj!\0\f\vA\0!\f\vA!\f\v  7\0 (\b!   kAj6\b E\r\0\f\v  O\r -\0\0-\0\x80Aq@@ "\0Aj! \0-\0-\0\x80Aq\r\0\v\v  O\r AA  A\x1B6\xE0\f\n\v  -\0\0A\nFj!  k")\0"B\b\x88\xA7!  B\x07\x83B\x07Q@A!A\0!\v\f\0\v\0\v\v  1\0\0 \xADB\b\x86\x84B\x80|7\0 Aj!\0@  Aj"K@ ! !\f\v \x1BAv \x1Bj"\x1BA\xFE\xFF\xFF\xFF\0K\r  \x1BAt""E\r   kj!   kj!  jA k! !\v B\x077\0   k6\b Aj \0 -\0A\nF\x1B!\0A\0! A!\f\v  1\0\0 \xADB\b\x86\x84B\x80|7\0 Aj!\0@  Aj"K@ ! !\f\v \x1BAv \x1Bj"\x1BA\xFE\xFF\xFF\xFF\0K\r  \x1BAt""E\r   kj!   kj!  jA k! !\v B7\0   k6\b Aj \0 -\0A\nF\x1B!A\0! A\0!\f\0\v\0\v  !6 A\x006 A6\f A6\b A6   !k6  A j"\x006\0   \0kAuAj6\f\v !\0 !\v AA \0 A\x1B6\xE0 E\r \x07\f\v AA \0 A\x1B6\xE0 E\r\v \x07\v !\x07A\0!\v A\xF0\bj$\0 \v\xF4P\x7F~@\x7F@@ \0E\r\0 \0)\0"\xA7!@@@@@ AqAF B\x80\xFE\xFF\xFF\xFF\x83B\0RqE@@@ A\x07qAk\x07\0\x07\b\v B\b\x88\xA7"A\xA6\xD5\xAA\xD5K\r\x07 \0(\b! Aj\b"\0E\r\x07 @ \0  \xFC\n\0\0\v \0 j! \0\f	\v B\b\x88\xA7"A\xA6\xD5\xAA\xD5K\r \0(\b! AlAj\b"\0E\r \0A":\0\0 B\x83B\0R\r\x07  j!\x07 \0!@ Aj!\x7F@@@@@@@@ \x07 k"AL\r\0@@@@@@@@@@@@ -\0\0"-\0\xC0p\r -\0-\0\xC0p\r\r -\0-\0\xC0p\r -\0-\0\xC0p\r -\0-\0\xC0pE@ -\0-\0\xC0p\r -\0-\0\xC0p\r -\0\x07-\0\xC0p\r -\0\b-\0\xC0p\r -\0	-\0\xC0p\r -\0\n-\0\xC0p\r\x07 -\0\v-\0\xC0p\r\b -\0\f-\0\xC0p\r	 -\0\r-\0\xC0p\r\n -\0-\0\xC0p\r\v -\0-\0\xC0p\r\f  )\0\b7\0\b  )\0\x007\0\0 Aj! \x07 Aj"k"AL\r\r\f\v\v  (\0\x006\0\0 Aj! Aj!\f\v  -\0:\0  (\0\x006\0\0 Aj! Aj!\f\v  /\0;\0  (\0\x006\0\0 Aj! Aj!\f\v  (\06\0  (\0\x006\0\0 A\x07j! A\x07j!\f\v  )\0\x007\0\0 A\bj! A\bj!\f\v  -\0\b:\0\b  )\0\x007\0\0 A	j! A	j!\f\r\v  /\0\b;\0\b  )\0\x007\0\0 A\nj! A\nj!\f\f\v  (\0\x076\0\x07  )\0\x007\0\0 A\vj! A\vj!\f\v\v  (\0\b6\0\b  )\0\x007\0\0 A\fj! A\fj!\f\n\v  )\07\0  )\0\x007\0\0 A\rj! A\rj!\f	\v  )\07\0  )\0\x007\0\0 Aj! Aj!\f\b\v  )\0\x077\0\x07  )\0\x007\0\0 Aj! Aj!\f\x07\v AL\r@ -\0\0"-\0\xC0p\r\x07 -\0-\0\xC0p\r -\0-\0\xC0p\r -\0-\0\xC0p\r  (\0\x006\0\0 Aj! \x07 Aj"kAJ\r\0\v\f\v  :\0\0 Aj! Aj!\f\v  /\0\0;\0\0\f\v  -\0:\0  /\0\0;\0\0\f\vA\f\vA\f\v@@@@  \x07O\r\0A\0! ! \x07 k"Aq"@@ -\0\0"\v-\0\xC0p@ !\f\x07\v  \v:\0\0 Aj! Aj! Aj" G\r\0\v\v AkAI\r\0  \x07j k!@ -\0\0"-\0\xC0p@ !\f\v  :\0\0 -\0"-\0\xC0p\r  :\0 -\0"-\0\xC0p\r  :\0 -\0"-\0\xC0p\r  :\0 Aj! Aj" G\r\0\v\v A":\0\0 Aj! \0\f\v Aj! Aj!\f\v Aj! Aj!\f\v Aj! Aj!\vA\0\v!@@@@@@@@@@@@@ \0\v@ Aj" \x07K"E@ -\0\0"-\0\xC0p!\f\v  \x07F\r\n \x07 k -\0\0"-\0\xC0p"AvH\r\v@@ A\xFFq\n\0\x07\b	\n\v\v  :\0\0 Aj!\f\r\v /\0\0"A\xE0\x81qA\xC0\x81G\r AqE\r  ;\0\0A!\f\v\v Aj! Aj!\f	\v@ E@ (\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0G\r\f\v /\0\0" -\0Atr"A\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0F\r\v  6\0\0A!\f	\v Aj! Aj!\f\x07\v (\0\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r A\x87\xE0\0qE\r AqA\0 A\x83\xE0\0q\x1B\r  6\0\0 Aj! !\f\v  At/\xC0v;\0\0 Aj! Aj!\f\v A\xDC\xEA\xC1\x816\0\0  -\0\0At/\xC0r;\0 Aj! Aj!\f\v /\0\0"A\xE0\x81qA\xC0\x81G\r AqE\r A\xDC\xEA;\0\0  AvAqA\xC0\xF2\0j/\0;\0  A\bvA?q AtrA\xFFqAt/\xC0r;\0 Aj! Aj!\f\v /\0\0" -\0"AtrA\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0F\r A\xDC\xEA;\0\0  AvA\xC0q" A?qrA\xFFqAt/\xC0r;\0  A\ft rA\x07vA\xFEqA\xC0\xF2\0j/\0;\0 Aj! Aj!\f\v (\0\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\r A\x87\xE0\0qE\r\r AqA\0 A\x83\xE0\0q\x1B\r\r A\xDC\xEA;\0 A\xDC\xEA;\0\0  AvAq/\xF8u;\0\b  AvA?q A\nv"A\xC0qrAt/\xC0r;\0\n  AtA\x80\x80\xF0\0q AtA\x80\xE0qrA\x80\x80k" A\x80qrA	vA\xFEq/\xC0r;\0  AvA\xB0jA\xFE\xFFq/\xC0r;\0 A\fj! !\f\v A":\0\0 Aj! \0\f\v\vA\0!\f\0\v\0\v\0\v \0(\bAvAlA\xC2\0jA|q"\b\b"E\r B\x07\x83B\x07Q! B\b\x88\xA7! " \bj"\x07!\n@@ A\xFB\0A\xDB\0 Aq"\v\x1B:\0\0 \0Aj!\0 Aj!  \vt!\f@@\x7F@@@@@ \0)\0"\xA7"A\x07q"Ak\0\v B\b\x88\xA7"A\xA6\xD5\xAA\xD5K\r\b \0(\b! \x07  AlAj"jM@ \bAv"   I\x1BAjA|q" \bA\x7FsK\r	   \bj"\b"E\r	  \b \n \x07k"\nkj! \n@   \x07 kj \n\xFC\n\0\0\v  \bj!\n   kj! \0)\0! !\x07 !\v A":\0\0 B\x83B\0R\r  j!	@ Aj!\x7F@@@@@@@@ 	 k"AL\r\0@@@@@@@@@@@@ -\0\0"-\0\xC0p\r -\0-\0\xC0p\r\r -\0-\0\xC0p\r -\0-\0\xC0p\r -\0-\0\xC0pE@ -\0-\0\xC0p\r -\0-\0\xC0p\r -\0\x07-\0\xC0p\r -\0\b-\0\xC0p\r -\0	-\0\xC0p\r -\0\n-\0\xC0p\r\x07 -\0\v-\0\xC0p\r\b -\0\f-\0\xC0p\r	 -\0\r-\0\xC0p\r\n -\0-\0\xC0p\r\v -\0-\0\xC0p\r\f  )\0\b7\0\b  )\0\x007\0\0 Aj! 	 Aj"k"AL\r\r\f\v\v  (\0\x006\0\0 Aj! Aj!\f\v  -\0:\0  (\0\x006\0\0 Aj! Aj!\f\v  /\0;\0  (\0\x006\0\0 Aj! Aj!\f\v  (\06\0  (\0\x006\0\0 A\x07j! A\x07j!\f\v  )\0\x007\0\0 A\bj! A\bj!\f\v  -\0\b:\0\b  )\0\x007\0\0 A	j! A	j!\f\r\v  /\0\b;\0\b  )\0\x007\0\0 A\nj! A\nj!\f\f\v  (\0\x076\0\x07  )\0\x007\0\0 A\vj! A\vj!\f\v\v  (\0\b6\0\b  )\0\x007\0\0 A\fj! A\fj!\f\n\v  )\07\0  )\0\x007\0\0 A\rj! A\rj!\f	\v  )\07\0  )\0\x007\0\0 Aj! Aj!\f\b\v  )\0\x077\0\x07  )\0\x007\0\0 Aj! Aj!\f\x07\v AL\r@ -\0\0"-\0\xC0p\r\x07 -\0-\0\xC0p\r -\0-\0\xC0p\r -\0-\0\xC0p\r  (\0\x006\0\0 Aj! 	 Aj"kAJ\r\0\v\f\v  :\0\0 Aj! Aj!\f\v  /\0\0;\0\0\f\v  -\0:\0  /\0\0;\0\0\f\vA\f\vA\f\v  	O\rA\0! ! 	 k"Aq"\r@@ -\0\0"-\0\xC0p@ !\f\v  :\0\0 Aj! Aj! Aj" \rG\r\0\v\v AkAI\r  	j k!@@@ -\0\0"-\0\xC0p@ !\f\v  :\0\0 -\0"-\0\xC0p\r  :\0 -\0"-\0\xC0p\r  :\0 -\0"-\0\xC0pE@  :\0 Aj! Aj" G\r\f\n\v\v Aj! Aj!\f\v Aj! Aj!\f\v Aj! Aj!\vA\0\v!@\x7F@@@@@@@@@@ \0\v@ Aj" 	K"\rE@ -\0\0"-\0\xC0p!\f\v  	F\r 	 k -\0\0"-\0\xC0p"AvH\r\v@@ A\xFFq\n\0\x07\b	\n\v  :\0\0 Aj!\f\f\v /\0\0"A\xE0\x81qA\xC0\x81G\r AqE\r  ;\0\0A!\f\n\v Aj! Aj\f\b\v@ \rE@ (\0\0"A\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0G\r\f\v /\0\0" -\0Atr"A\xF0\x81\x83qA\xE0\x81\x82G\r A\x8F\xC0\0q"E\r A\x8D\xC0\0F\r\v  6\0\0A!\f\b\v Aj! Aj\f\v (\0\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r A\x87\xE0\0qE\r AqA\0 A\x83\xE0\0q\x1B\r  6\0\0 ! Aj\f\v  At/\xC0v;\0\0 Aj! Aj\f\v A\xDC\xEA\xC1\x816\0\0  -\0\0At/\xC0r;\0 Aj! Aj\f\v /\0\0"A\xE0\x81qA\xC0\x81G\r\r AqE\r\r A\xDC\xEA;\0\0  AvAqA\xC0\xF2\0j/\0;\0  A\bvA?q AtrA\xFFqAt/\xC0r;\0 Aj! Aj\f\v /\0\0" -\0"AtrA\xF0\x81\x83qA\xE0\x81\x82G\r\f A\x8F\xC0\0q"E\r\f A\x8D\xC0\0F\r\f A\xDC\xEA;\0\0  AvA\xC0q" A?qrA\xFFqAt/\xC0r;\0  A\ft rA\x07vA\xFEqA\xC0\xF2\0j/\0;\0 Aj! Aj\f\v (\0\0"A\xF8\x81\x83\x86|qA\xF0\x81\x82\x84xG\r\v A\x87\xE0\0qE\r\v AqA\0 A\x83\xE0\0q\x1B\r\v A\xDC\xEA;\0 A\xDC\xEA;\0\0  AvAq/\xF8u;\0\b  AvA?q A\nv"A\xC0qrAt/\xC0r;\0\n  AtA\x80\x80\xF0\0q AtA\x80\xE0qrA\x80\x80k" A\x80qrA	vA\xFEq/\xC0r;\0  AvA\xB0jA\xFE\xFFq/\xC0r;\0 ! A\fj\v!A\0!\f\0\v\0\v\0\v AqAF@@ \x07 A\bjK@ \x07! !\f\vA \b \bAM\x1BAvAjA|q" \bA\x7FsK\r	   \bj"\b"E\r	  \b \n \x07k"kj! @   \x07 kj \xFC\n\0\0\v  \bj!\n   kj!\v B\b\x88\xA7"E@ A,:\0 A A\0 A\x07F\x1B"A\xDD\0r:\0  A\xDB\0r:\0\0 !\x07 ! Aj\f\v A\x07F! Ak"\x07 \fAt \vr6\0 !\f\x07\v@@@ Ak\0\n\v \x07 AjM@A! \b \bA!M\x1BAvAjA|q" \bA\x7FsK\r\n   \bj"\b"E\r\n  \b \n \x07k"kj! @   \x07 kj \xFC\n\0\0\v  \bj!\n   kj! \0)\0! !\x07 !\v B\xF4\xE4\xD5\xAB\xC6\xC5B\xE6\xC2\xB1\x9B\xD7\x8C\x8B B\x83B\0R"\x1B7\0\0  kAj\f\v \x07 AjM@A! \b \bA!M\x1BAvAjA|q" \bA\x7FsK\r	   \bj"\b"E\r	  \b \n \x07k"kj! @   \x07 kj \xFC\n\0\0\v  \bj!\n   kj! !\x07 !\v B\xEE\xEA\xB1\xE3\xC6\xC57\0\0 Aj\f\v B\b\x88\xA7"A\xA6\xD5\xAA\xD5K\r\x07 \0(\b!	@ \x07  Aj"jK@ \x07! !\f\v \bAv"   I\x1BAjA|q" \bA\x7FsK\r\b   \bj"\b"E\r\b  \b \n \x07k"kj! @   \x07 kj \xFC\n\0\0\v  \bj!\n   kj!\v @  	 \xFC\n\0\0\v  j"A,:\0\0 !\x07 ! Aj\f\v \x07 A(jM@A\xD1\0 \b \bA\xD1\0M\x1BAvAjA|q" \bA\x7FsK\r\x07   \bj"\b"E\r\x07  \b \n \x07k"kj! @   \x07 kj \xFC\n\0\0\v  \bj!\n   kj! \0)\0! !\x07 !\v \0)\b!@ B\x83P@ A-:\0\0  B?\x88\xA7 \xA7Avq"j!B\0 }  \x1B"B\xFF\xC1\xD7/X@ \xA7! B\xE3\0X@  B\nT" Atr/\0\xA0j;\0\0  kAj!\f\v B\x8F\xCE\0X@  B\xE8\x07T" A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\x9C\x7Fl jAt/\xA0j;\0 Aj!\f\v B\xBF\x84=X@  B\xA0\x8DT" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0 Aj!\f\v  B\x80\xAD\xE2T" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj!\f\v B\x80\xC2\xD7/\x80"B\x80\xBE\xA8\xD0~ |"\xA7! B\xFF\xFF\x83\xFE\xA6\xDE\xE1X@ \xA7!\x7F B\xFF\xC7\xAF\xA0%X@  B\x80\x94\xEB\xDCT" Atr/\0\xA0j;\0\0  kAj\f\v B\xFF\x9F\x94\xA5\x8DX@  B\x80\xD0\xDB\xC3\xF4T" A\xFB(lAv"Atr/\0\xA0j;\0\0  k" A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v B\xFF\xFF\xE8\x83\xB1\xDEX@  B\x80\xC0\xCA\xF3\x84\xA3T" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v  B\x80\x80\x9A\xA6\xEA\xAF\xE3T" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"	Atr/\0\xA0j;\0\0  k" A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  	A\x9C\x7Fl jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj\v" B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0\0  A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj!\f\v B\x80\xA0\x94\xA5\x8D\x80"\xA7! B\xF0\xB1\xFF\xFF~ |\xA7!\x7F B\xFF\xFF\x8F\xBB\xBA\xD6\xAD\xF0\rX@  B\x80\x80\xA8\xEC\x85\xAF\xD1\xB1T" B\xB9\x9B~B \x88\xA7"	Atr/\0\xA0j;\0\0  k" 	A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0  A\x9C\x7Fl jAt/\xA0j;\0 Aj\f\v  B\x80\x80\xA0\xCF\xC8\xE0\xC8\xE3\x8A\x7FT"	 B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"\rAtr/\0\xA0j;\0\0  	k" A\xF0\xB1\x7Fl j"A\xFB(lAv"	At/\xA0j;\0  \rA\x9C\x7Fl jAt/\xA0j;\0  	A\x9C\x7Fl jAt/\xA0j;\0 A\bj\v" A\xFB(lAv"At/\xA0j;\0\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0  B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"At/\xA0j;\0  A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0\b  A\x9C\x7Fl jAt/\xA0j;\0  A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0\n A\fj!\f\v\x7F@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\0X\r\0 B\x80\x80\x80\x80\x80\x80\x80\x80Z@   B<\x88\xA7\f\v B\x80\x80\x80\x80\x80\x80\x80\x80\bT\r\0  \f\v  \v"E\r\x07\v A,:\0\0 Aj\f\v Aj!@ AI\r\0A\0! Ak"	AvAjAq"@@  )\0\b7\0\b  )\0\x007\0\0 Aj! Aj! Aj" G\r\0\v  Atk!\v 	A/M\r\0@  )\0\b7\0\b  )\0\x007\0\0  )\07\0  )\07\0  )\0(7\0(  )\0 7\0   )\x0007\x000  )\x0087\x008 A@k! A@k! A@j"AK\r\0\v\v@ AI\r\0A\0! Ak"	AvAjA\x07q"@@  (\0\x006\0\0 Aj! Aj! Aj" G\r\0\v  Atk!\v 	AI\r\0@  (\0\x006\0\0  (\06\0  (\0\b6\0\b  (\0\f6\0\f  (\06\0  (\06\0  (\06\0  (\06\0 A j! A j! A k"AK\r\0\v\v E\r\0A\0! ! A\x07q"	@@  -\0\0:\0\0 Aj! Aj! Aj" 	G\r\0\v Axq!\v A\bI\r\0@  -\0\0:\0\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0\x07:\0\x07 A\bj! A\bj! A\bk"\r\0\v\v A":\0\0 A:A, \v \fA\x7Fsq\x1B:\0 Aj\v! \0Aj!\0 \fAk"\f\r\0\v@@ A,:\0\0 Ak \vAtA\xDD\0j:\0\0 \x07 \nO\r Aj! \x07(\0"Aq!\v \x07Aj!\x07 AvAk"\fE\r\0\v\f\v\v\v A\0:\0\0 !\f\v \x07A\0\vA\b"\0E\r \0A\xFB\xFA;\0\0 \0Aj! \0\f\vA\b"\0E\r \0A\xDB\xBA;\0\0 \0Aj! \0\f\vA\b\b"\0E\r \0B\xEE\xEA\xB1\xE3\xC6\xC57\0\0 \0Aj! \0\f\vA\b\b"\0E\r \0B\xF4\xE4\xD5\xAB\xC6\xC5B\xE6\xC2\xB1\x9B\xD7\x8C\x8B B\x83B\0R"\x1B7\0\0 \0 kAj! \0\f\vA*\b"E\r\0 \0)\b! B\x83P@ A-:\0\0  B?\x88\xA7 Avq"j!\0B\0 }  \x1B"B\xFF\xC1\xD7/X@ \xA7! B\xE3\0X@ \0 B\nT" Atr/\0\xA0j;\0\0 \0 kAj! \f\v B\x8F\xCE\0X@ \0 B\xE8\x07T" A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj! \f\v B\xBF\x84=X@ \0 B\xA0\x8DT" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj! \f\v \0 B\x80\xAD\xE2T" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"\x07Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 \x07A\x9C\x7Fl jAt/\xA0j;\0 \0 A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0A\bj! \f\v B\x80\xC2\xD7/\x80"B\x80\xBE\xA8\xD0~ |"\xA7! B\xFF\xFF\x83\xFE\xA6\xDE\xE1X@ \xA7!\x7F B\xFF\xC7\xAF\xA0%X@ \0 B\x80\x94\xEB\xDCT" Atr/\0\xA0j;\0\0 \0 kAj\f\v B\xFF\x9F\x94\xA5\x8DX@ \0 B\x80\xD0\xDB\xC3\xF4T" A\xFB(lAv"\x07Atr/\0\xA0j;\0\0 \0 k"\0 \x07A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v B\xFF\xFF\xE8\x83\xB1\xDEX@ \0 B\x80\xC0\xCA\xF3\x84\xA3T" B\xB9\x9B~B \x88\xA7"\x07Atr/\0\xA0j;\0\0 \0 k"\0 \x07A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v \0 B\x80\x80\x9A\xA6\xEA\xAF\xE3T"\x07 B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 \x07k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"\x07At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 \x07A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 \0A\bj\v" B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"\0A\xFB(lAv"At/\xA0j;\0\0  \0A\xF0\xB1\x7Fl j"A\xFB(lAv"\x07At/\xA0j;\0  A\x9C\x7Fl \0jAt/\xA0j;\0  \x07A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0 A\bj! \f\v B\x80\xA0\x94\xA5\x8D\x80"\xA7! B\xF0\xB1\xFF\xFF~ |\xA7!\x07\x7F B\xFF\xFF\x8F\xBB\xBA\xD6\xAD\xF0\rX@ \0 B\x80\x80\xA8\xEC\x85\xAF\xD1\xB1T" B\xB9\x9B~B \x88\xA7"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0Aj\f\v \0 B\x80\x80\xA0\xCF\xC8\xE0\xC8\xE3\x8A\x7FT" B\xBB\xF1\xB64~B(\x88\xA7"A\xFB(lAv"Atr/\0\xA0j;\0\0 \0 k"\0 A\xF0\xB1\x7Fl j"A\xFB(lAv"At/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0 A\x9C\x7Fl jAt/\xA0j;\0 \0A\bj\v" \x07A\xFB(lAv"\0At/\xA0j;\0\0  \0A\x9C\xFF\xFF\xFF\x07l \x07jAt/\xA0j;\0  B\xFF\xFF\xFF\xFF\x83B\xBB\xF1\xB64~B(\x88\xA7"\0A\xFB(lAv"At/\xA0j;\0  \0A\xF0\xB1\x7Fl j"A\xFB(lAv"\x07At/\xA0j;\0\b  A\x9C\x7Fl \0jAt/\xA0j;\0  \x07A\x9C\xFF\xFF\xFF\x07l jAt/\xA0j;\0\n A\fj! \f\v@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\0X@  "E\r \f\v B\x80\x80\x80\x80\x80\x80\x80\x80Z@   B<\x88\xA7"E\r \f\v B\x80\x80\x80\x80\x80\x80\x80\x80\bZ@  "E\r \f\v  "E\r\0 \f\v \x07A\0\v \v \0Aj!@ AI\r\0 Ak"\x07AvAjAq"@@  )\0\b7\0\b  )\0\x007\0\0 Aj! Aj! Aj" G\r\0\v  Atk!\v \x07A/M\r\0@  )\0\b7\0\b  )\0\x007\0\0  )\07\0  )\07\0  )\0(7\0(  )\0 7\0   )\x0007\x000  )\x0087\x008 A@k! A@k! A@j"AK\r\0\v\v@ AI\r\0 Ak"\x07AvAjA\x07q"@A\0!@  (\0\x006\0\0 Aj! Aj! Aj" G\r\0\v  Atk!\v \x07AI\r\0@  (\0\x006\0\0  (\06\0  (\0\b6\0\b  (\0\f6\0\f  (\06\0  (\06\0  (\06\0  (\06\0 A j! A j! A k"AK\r\0\v\v@ E\r\0 A\x07q"\x7FA\0!@  -\0\0:\0\0 Aj! Aj! Aj" G\r\0\v Axq \v! A\bI\r\0@  -\0\0:\0\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0:\0  -\0\x07:\0\x07 A\bj! A\bj! A\bk"\r\0\v\v A":\0\0 Aj! \0\v A\0:\0\0\v \0\x07A\0\v\xAD\v\x07\x7F \0 j!@@ \0("Aq\r\0 AqE\r \0(\0" j!@@@ \0 k"\0A\xD8\x80(\0G@ \0(\f! A\xFFM@  \0(\b"G\rA\xC4\x80A\xC4\x80(\0A~ Avwq6\0\f\v \0(! \0 G@ \0(\b" 6\f  6\b\f\v \0("\x7F \0Aj \0("E\r \0Aj\v!@ !\x07 "Aj! ("\r\0 Aj! ("\r\0\v \x07A\x006\0\f\v ("AqAG\rA\xCC\x80 6\0  A~q6 \0 Ar6  6\0\v  6\f  6\b\f\vA\0!\v E\r\0@ \0("At"(\xF4\x82 \0F@ A\xF4\x82j 6\0 \rA\xC8\x80A\xC8\x80(\0A~ wq6\0\f\v@ \0 (F@  6\f\v  6\v E\r\v  6 \0("@  6  6\v \0("E\r\0  6  6\v@@@@ ("AqE@A\xDC\x80(\0 F@A\xDC\x80 \x006\0A\xD0\x80A\xD0\x80(\0 j"6\0 \0 Ar6 \0A\xD8\x80(\0G\rA\xCC\x80A\x006\0A\xD8\x80A\x006\0\vA\xD8\x80(\0"\b F@A\xD8\x80 \x006\0A\xCC\x80A\xCC\x80(\0 j"6\0 \0 Ar6 \0 j 6\0\v Axq j! (\f! A\xFFM@ (\b" F@A\xC4\x80A\xC4\x80(\0A~ Avwq6\0\f\v  6\f  6\b\f\v (!  G@ (\b" 6\f  6\b\f\v ("\x7F Aj ("E\r Aj\v!@ !\x07 "Aj! ("\r\0 Aj! ("\r\0\v \x07A\x006\0\f\v  A~q6 \0 Ar6 \0 j 6\0\f\vA\0!\v E\r\0@ ("At"(\xF4\x82 F@ A\xF4\x82j 6\0 \rA\xC8\x80A\xC8\x80(\0A~ wq6\0\f\v@  (F@  6\f\v  6\v E\r\v  6 ("@  6  6\v ("E\r\0  6  6\v \0 Ar6 \0 j 6\0 \0 \bG\r\0A\xCC\x80 6\0\v A\xFFM@ A\xF8qA\xEC\x80j!\x7FA\xC4\x80(\0"A Avt"qE@A\xC4\x80  r6\0 \f\v (\b\v!  \x006\b  \x006\f \0 6\f \0 6\b\vA! A\xFF\xFF\xFF\x07M@ A& A\bvg"kvAq AtrA>s!\v \0 6 \0B\x007 AtA\xF4\x82j!@@A\xC8\x80(\0"A t"\x07qE@A\xC8\x80  \x07r6\0  \x006\0 \0 6\f\v A AvkA\0 AG\x1Bt! (\0!@ "(Axq F\r Av! At!  Aqj"\x07("\r\0\v \x07 \x006 \0 6\v \0 \x006\f \0 \x006\b\v (\b" \x006\f  \x006\b \0A\x006 \0 6\f \0 6\b\v\v/\0@ A\xFF\0M\r\0 A\x80\x7FqA\x80\xBFF\r\0A\xC0\x80A6\0A\x7F\v \0 :\0\0A\v~\x7F~ \0\xBD"B4\x88\xA7A\xFFq"A\xFFG| E@  \0D\0\0\0\0\0\0\0\0a\x7FA\0 \0D\0\0\0\0\0\0\xF0C\xA2  !\0 (\0A@j\v6\0 \0\v  A\xFE\x07k6\0 B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x87\x80\x7F\x83B\x80\x80\x80\x80\x80\x80\x80\xF0?\x84\xBF \0\v\v\xB2~\x7F  (\0A\x07jAxq"Aj6\0 \0 )\0! )\b!#\0A k"\0$\0 B\xFF\xFF\xFF\xFF\xFF\xFF?\x83!~ B0\x88B\xFF\xFF\x83"\xA7"\bA\x81\xF8\0kA\xFDM@ B\x86 B<\x88\x84! \bA\x80\xF8\0k\xAD!@ B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x83"B\x81\x80\x80\x80\x80\x80\x80\x80\bZ@ B|!\f\v B\x80\x80\x80\x80\x80\x80\x80\x80\bR\r\0 B\x83 |!\vB\0  B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07V"\x1B! \xAD |\f\v@  \x84P\r\0 B\xFF\xFFR\r\0 B\x86 B<\x88\x84B\x80\x80\x80\x80\x80\x80\x80\x84!B\xFF\f\v \bA\xFE\x87K@B\0!B\xFF\f\vA\x80\xF8\0A\x81\xF8\0 P"	\x1B"\n \bk"A\xF0\0J@B\0!B\0\f\v  B\x80\x80\x80\x80\x80\x80\xC0\0\x84 	\x1B!A\0!	 \b \nG@ ! !@A\x80 k"\bA\xC0\0q@  \bA@j\xAD\x86!B\0!\f\v \bE\r\0  \b\xAD"\x07\x86 A\xC0\0 \bk\xAD\x88\x84!  \x07\x86!\v \0 7 \0 7 \0) \0)\x84B\0R!	\v@ A\xC0\0q@  A@j\xAD\x88!B\0!\f\v E\r\0 A\xC0\0 k\xAD\x86  \xAD"\x88\x84!  \x88!\v \0 7\0 \0 7\b \0)\bB\x86 \0)\0"B<\x88\x84!@ 	\xAD B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x83\x84"B\x81\x80\x80\x80\x80\x80\x80\x80\bZ@ B|!\f\v B\x80\x80\x80\x80\x80\x80\x80\x80\bR\r\0 B\x83 |!\v B\x80\x80\x80\x80\x80\x80\x80\b\x85  B\xFF\xFF\xFF\xFF\xFF\xFF\xFF\x07V"\x1B! \xAD\v! \0A j$\0 B\x80\x80\x80\x80\x80\x80\x80\x80\x80\x7F\x83 B4\x86\x84 \x84\xBF9\0\v\xCE\x7F|~#\0A\xB0k"\f$\0 \fA\x006\xAC@ \xBD"B\0S@A!A\xA4\b! \x9A"\xBD!\f\v A\x80q@A!A\xA7\b!\f\vA\xAA\bA\xA5\b Aq"\x1B! E!\v@ B\x80\x80\x80\x80\x80\x80\x80\xF8\xFF\0\x83B\x80\x80\x80\x80\x80\x80\x80\xF8\xFF\0Q@ \0A   Aj" A\xFF\xFF{q\n \0  	 \0A\xB1	A\xEC\f A q"\x1BA\xBB\vA\xF0\f \x1B  b\x1BA	 \0A    A\x80\xC0\0s\n    J\x1B!\n\f\v \fA\x90j!@@@  \fA\xACj " \xA0"D\0\0\0\0\0\0\0\0b@ \f \f(\xAC"Ak6\xAC A r"A\xE1\0G\r\f\v A r"A\xE1\0F\r \f(\xAC!\n\f\v \f Ak"\n6\xAC D\0\0\0\0\0\0\xB0A\xA2!\vA  A\0H\x1B!\v \fA\xE8A\0 \nA\0N\x1Bj"\r!\x07@ \x07 \xFC"6\0 \x07Aj!\x07  \xB8\xA1D\0\0\0\0e\xCD\xCDA\xA2"D\0\0\0\0\0\0\0\0b\r\0\v@ \nA\0L@ \n!	 \x07! \r!\b\f\v \r!\b \n!	@A 	 	AO\x1B!@ \x07Ak" \bI\r\0 \xAD!\x1BB\0!@  5\0 \x1B\x86 |" B\x80\x94\xEB\xDC\x80"B\x80\xEC\x94\xA3\f~|>\0 Ak" \bO\r\0\v B\x80\x94\xEB\xDCT\r\0 \bAk"\b >\0\v@ \b \x07"I@ Ak"\x07(\0E\r\v\v \f \f(\xAC k"	6\xAC !\x07 	A\0J\r\0\v\v 	A\0H@ \vAjA	nAj! A\xE6\0F!@A	A\0 	k" A	O\x1B!@  \bM@A\0A \b(\0\x1B!\x07\f\vA\x80\x94\xEB\xDC v!A\x7F tA\x7Fs!A\0!	 \b!\x07@ \x07 	 \x07(\0" vj6\0  q l!	 \x07Aj"\x07 I\r\0\vA\0A \b(\0\x1B!\x07 	E\r\0  	6\0 Aj!\v \f \f(\xAC j"	6\xAC \r \x07 \bj"\b \x1B" Atj   kAu J\x1B! 	A\0H\r\0\v\vA\0!	@  \bM\r\0 \r \bkAuA	l!	A\n!\x07 \b(\0"A\nI\r\0@ 	Aj!	  \x07A\nl"\x07O\r\0\v\v \v 	A\0 A\xE6\0G\x1Bk A\xE7\0F \vA\0Gqk"  \rkAuA	lA	kH@ \fA\x84`A\xECc \nA\0H\x1Bj A\x80\xC8\0j"A	m"Atj!\nA\n!\x07 Awl j"A\x07L@@ \x07A\nl!\x07 Aj"A\bG\r\0\v\v@ \n(\0"  \x07n" \x07l"F \nAj" Fq\r\0  k!@ AqE@D\0\0\0\0\0\0@C! \x07A\x80\x94\xEB\xDCG\r \b \nO\r \nAk-\0\0AqE\r\vD\0\0\0\0\0@C!\vD\0\0\0\0\0\0\xE0?D\0\0\0\0\0\0\xF0?D\0\0\0\0\0\0\xF8?  F\x1BD\0\0\0\0\0\0\xF8?  \x07Av"F\x1B  K\x1B!@ \r\0 -\0\0A-G\r\0 \x9A! \x9A!\v \n 6\0  \xA0 a\r\0 \n \x07 j"6\0 A\x80\x94\xEB\xDCO@@ \nA\x006\0 \b \nAk"\nK@ \bAk"\bA\x006\0\v \n \n(\0Aj"6\0 A\xFF\x93\xEB\xDCK\r\0\v\v \r \bkAuA	l!	A\n!\x07 \b(\0"A\nI\r\0@ 	Aj!	  \x07A\nl"\x07O\r\0\v\v \nAj"   I\x1B!\v@ " \bM"\x07E@ Ak"(\0E\r\v\v@ A\xE7\0G@ A\bq!\f\v 	A\x7FsA\x7F \vA \v\x1B" 	J 	A{Jq"\x1B j!\vA\x7FA~ \x1B j! A\bq"\r\0Aw!@ \x07\r\0 Ak(\0"\nE\r\0A\n!A\0! \nA\np\r\0@ "\x07Aj! \n A\nl"pE\r\0\v \x07A\x7Fs!\v  \rkAuA	l!\x07 A_qA\xC6\0F@A\0! \v  \x07jA	k"A\0 A\0J\x1B"  \vJ\x1B!\v\f\vA\0! \v \x07 	j jA	k"A\0 A\0J\x1B"  \vJ\x1B!\v\vA\x7F!\n \vA\xFD\xFF\xFF\xFF\x07A\xFE\xFF\xFF\xFF\x07  \vr"\x1BJ\r \v A\0GjAj!@ A_q"\x07A\xC6\0F@ 	 A\xFF\xFF\xFF\xFF\x07sJ\r 	A\0 	A\0J\x1B!\f\v  	 	Au"s k\xAD "kAL@@ Ak"A0:\0\0  kAH\r\0\v\v Ak" :\0\0 AkA-A+ 	A\0H\x1B:\0\0  k" A\xFF\xFF\xFF\xFF\x07sJ\r\v  j" A\xFF\xFF\xFF\xFF\x07sJ\r \0A    j"\n \n \0  	 \0A0  \n A\x80\x80s\n@@@ \x07A\xC6\0F@ \fA\x90jA	r! \r \b \b \rK\x1B"!\b@ \b5\0 !@  \bG@  \fA\x90jM\r@ Ak"A0:\0\0  \fA\x90jK\r\0\v\f\v  G\r\0 Ak"A0:\0\0\v \0   k	 \bAj"\b \rM\r\0\v @ \0A\xFA\fA	\v \b O\r \vA\0L\r@ \b5\0 " \fA\x90jK@@ Ak"A0:\0\0  \fA\x90jK\r\0\v\v \0 A	 \v \vA	N\x1B	 \vA	k! \bAj"\b O\r \vA	J !\v\r\0\v\f\v@ \vA\0H\r\0  \bAj \b I\x1B! \fA\x90jA	r!\r \b!\x07@ \r \x075\0 \r"F@ Ak"A0:\0\0\v@ \x07 \bG@  \fA\x90jM\r@ Ak"A0:\0\0  \fA\x90jK\r\0\v\f\v \0 A	 Aj!  \vrE\r\0 \0A\xFA\fA	\v \0  \r k" \v  \vH\x1B	 \v k!\v \x07Aj"\x07 O\r \vA\0N\r\0\v\v \0A0 \vAjAA\0\n \0   k	\f\v \v!\v \0A0 A	jA	A\0\n\v \0A   \n A\x80\xC0\0s\n  \n  \nJ\x1B!\n\f\v  AtAuA	qj!	@ A\fK\r\0 	-\0\0D\0\0\0\0\0\0\xF0?!@A4 Atk"\x07A\x80\bN@D\0\0\0\0\0\0\xE0\x7F! \x07A\xFFI@ \x07A\xFF\x07k!\x07\f\vD\0\0\0\0\0\0\xF0\x7F!A\xFD \x07 \x07A\xFDO\x1BA\xFEk!\x07\f\v \x07A\x81xJ\r\0D\0\0\0\0\0\0`! \x07A\xB8pK@ \x07A\xC9\x07j!\x07\f\vD\0\0\0\0\0\0\0\0!A\xF0h \x07 \x07A\xF0hM\x1BA\x92j!\x07\v  \x07A\xFF\x07j\xADB4\x86\xBF\xA2!A-F@  \x9A \xA1\xA0\x9A!\f\v  \xA0 \xA1!\v  \f(\xAC"\x07 \x07Au"s k\xAD "F@ Ak"A0:\0\0 \f(\xAC!\x07\v A q!\r Ak"\v Aj:\0\0 AkA-A+ \x07A\0H\x1B:\0\0 A\bqE A\0Lq!\b \fA\x90j!\x07@ \x07" \xFC"A\xA0\x80j-\0\0 \rr:\0\0  \xB7\xA1D\0\0\0\0\0\x000@\xA2!@ \x07Aj"\x07 \fA\x90jkAG\r\0 D\0\0\0\0\0\0\0\0a \bq\r\0 A.:\0 Aj!\x07\v D\0\0\0\0\0\0\0\0b\r\0\vA\x7F!\n A\xFB\xFF\xFF\xFF\x07   \vk"\bjkJ\r\0 \0A   Aj \x07 \fA\x90j"k"\r \rAk H\x1B \r \x1B" \b Ar"jj"\x07 \n \0 	 	 \0A0  \x07 A\x80\x80s\n \0  \r	 \0A0  \rkA\0A\0\n \0 \v \b	 \0A   \x07 A\x80\xC0\0s\n  \x07  \x07J\x1B!\n\v \fA\xB0j$\0 \n\v\xB9\0@@@@@@@@@@@ A	k\0\b	\n\b	\n	\n\n\b	\x07\v  (\0"Aj6\0 \0 (\x006\0\v  (\0"Aj6\0 \0 2\x007\0\v  (\0"Aj6\0 \0 3\x007\0\v  (\0"Aj6\0 \0 0\0\x007\0\v  (\0"Aj6\0 \0 1\0\x007\0\v  (\0A\x07jAxq"A\bj6\0 \0 +\x009\0\v \0 !\v\v  (\0"Aj6\0 \0 4\x007\0\v  (\0"Aj6\0 \0 5\x007\0\v  (\0A\x07jAxq"A\bj6\0 \0 )\x007\0\vo\x7F \0(\0",\0\0A0k"A	K@A\0\v@A\x7F! A\xCC\x99\xB3\xE6\0M@A\x7F  A\nl"j  A\xFF\xFF\xFF\xFF\x07sK\x1B!\v \0 Aj"6\0 ,\0 ! !A0k"A\nI\r\0\v \v\xA6\x7F~#\0A@j"$\0  6< A)j! A\'j! A(j!@@@@@A\0!@ !\v  \fA\xFF\xFF\xFF\xFF\x07sJ\r  \fj!\f@@@@ "-\0\0"\n@@@@ \nA\xFFq"E@ !\f\v A%G\r !\n@ \n-\0A%G@ \n!\f\v Aj! \n-\0 \nAj"!\nA%F\r\0\v\v  \vk" \fA\xFF\xFF\xFF\xFF\x07s"J\r	 \0@ \0 \v 	\v \r\x07  6< Aj!A\x7F!@ ,\0A0k"	A	K\r\0 -\0A$G\r\0 Aj!A! 	!\v  6<A\0!\x07@ ,\0\0"\nA k"AK@ !	\f\v !	A t"A\x89\xD1qE\r\0@  Aj"	6<  \x07r!\x07 ,\0"\nA k"A O\r 	!A t"A\x89\xD1q\r\0\v\v@ \nA*F@\x7F@ 	,\0A0k"A	K\r\0 	-\0A$G\r\0\x7F \0E@  AtjA\n6\0A\0\f\v  Atj(\0\v! 	Aj!A\f\v \r 	Aj! \0E@  6<A\0!A\0!\f\v  (\0"Aj6\0 (\0!A\0\v!  6< A\0N\rA\0 k! \x07A\x80\xC0\0r!\x07\f\v A<j$"A\0H\r\n (<!\vA\0!A\x7F!\b\x7FA\0 -\0\0A.G\r\0 -\0A*F@\x7F@ ,\0A0k"	A	K\r\0 -\0A$G\r\0 Aj!\x7F \0E@  	AtjA\n6\0A\0\f\v  	Atj(\0\v\f\v \r Aj!A\0 \0E\r\0  (\0"	Aj6\0 	(\0\v!\b  6< \bA\0N\f\v  Aj6< A<j$!\b (<!A\v!@ !A!	 "\r,\0\0"A\xFB\0kAFI\r\v Aj! A:l jA\x8F\xFC\0j-\0\0"AkA\xFFqA\bI\r\0\v  6<@ A\x1BG@ E\r\f A\0N@ \0E@  Atj 6\0\f\f\v   Atj)\x0070\f\v \0E\r\b A0j  #\f\v A\0N\r\vA\0! \0E\r\b\v \0-\0\0A q\r\v \x07A\xFF\xFF{q"\n \x07 \x07A\x80\xC0\0q\x1B!\x07A\0!A\x9A\b! !	@@\x7F@@@@@@\x7F@@@@@@@ \r-\0\0"\xC0"\rASq \r AqAF\x1B \r \x1B"A\xD8\0k!	\n\0\v@ A\xC1\0k\x07\v\0\v A\xD3\0F\r\v\f\v )0!A\x9A\b\f\vA\0!@@@@@@@ \b\0\v (0 \f6\0\f\x1B\v (0 \f6\0\f\v (0 \f\xAC7\0\f\v (0 \f;\0\f\v (0 \f:\0\0\f\v (0 \f6\0\f\v (0 \f\xAC7\0\f\vA\b \b \bA\bM\x1B!\b \x07A\br!\x07A\xF8\0!\v ! )0""B\0R@ A q!\v@ Ak" \xA7Aq-\0\xA0\x80 \vr:\0\0 B\x88"B\0R\r\0\v\v !\v P\r \x07A\bqE\r AvA\x9A\bj!A!\f\v ! )0""B\0R@@ Ak" \xA7A\x07qA0r:\0\0 B\x88"B\0R\r\0\v\v !\v \x07A\bqE\r \b  k"  \bH\x1B!\b\f\v )0"B\0S@ B\0 }"70A!A\x9A\b\f\v \x07A\x80q@A!A\x9B\b\f\vA\x9C\bA\x9A\b \x07Aq"\x1B\v!  !\v\v  \bA\0Hq\r \x07A\xFF\xFF{q \x07 \x1B!\x07@ B\0R\r\0 \b\r\0 !\vA\0!\b\f\v \b P  \vkj"  \bH\x1B!\b\f\r\v -\x000!\f\v\v\x7FA\xFF\xFF\xFF\xFF\x07 \b \bA\xFF\xFF\xFF\xFF\x07O\x1B""\x07A\0G!	@@@ (0"A\xFC\f \x1B"\v"\rAqE\r\0 \x07E\r\0@ \r-\0\0E\r \x07Ak"\x07A\0G!	 \rAj"\rAqE\r \x07\r\0\v\v 	E\r@ \r-\0\0E\r\0 \x07AI\r\0@A\x80\x82\x84\b \r(\0"k rA\x80\x81\x82\x84xqA\x80\x81\x82\x84xG\r \rAj!\r \x07Ak"\x07AK\r\0\v\v \x07E\r\v@ \r \r-\0\0E\r \rAj!\r \x07Ak"\x07\r\0\v\vA\0\v" \vk  \x1B" \vj!	 \bA\0N@ \n!\x07 !\b\f\f\v \n!\x07 !\b 	-\0\0\r\f\v\v )0"B\0R\rA\0!\f	\v \b@ (0\f\vA\0! \0A  A\0 \x07\n\f\v A\x006\f  >\b  A\bj"60A\x7F!\b \v!\nA\0!@@ \n(\0"\vE\r\0 Aj \v"\vA\0H\r \v \b kK\r\0 \nAj!\n  \vj" \bI\r\v\vA=!	 A\0H\r\f \0A    \x07\n E@A\0!\f\vA\0!	 (0!\n@ \n(\0"\vE\r Aj"\b \v"\v 	j"	 K\r \0 \b \v	 \nAj!\n  	K\r\0\v\v \0A    \x07A\x80\xC0\0s\n    H\x1B!\f\b\v  \bA\0Hq\r	A=!	 \0 +0  \b \x07  ""A\0N\r\x07\f\n\v -\0!\n Aj!\f\0\v\0\v \0\r	 E\rA!@  Atj(\0"\0@  Atj \0 #A!\f Aj"A\nG\r\f\v\v\v A\nO@A!\f\f\n\v@  Atj(\0\rA!\f Aj"A\nG\r\0\v\f	\vA!	\f\v  :\0\'A!\b !\v \n!\x07\v \b 	 \vk"\n \b \nJ\x1B" A\xFF\xFF\xFF\xFF\x07sJ\rA=!	   j"\b \b H\x1B" K\r \0A   \b \x07\n \0  	 \0A0  \b \x07A\x80\x80s\n \0A0  \nA\0\n \0 \v \n	 \0A   \b \x07A\x80\xC0\0s\n (<!\f\v\v\vA\0!\f\f\vA=!	\vA\xC0\x80 	6\0\vA\x7F!\f\v A@k$\0 \f\vY\x7F \0 \0(H"Ak r6H \0(\0"A\bq@ \0 A r6\0A\x7F\v \0B\x007 \0 \0(,"6 \0 6 \0  \0(0j6A\0\v\xD7\x7F@ \0Aq@@ \0-\0\0"E\r A,F\r \0Aj"\0Aq\r\0\v\v@@A\x80\x82\x84\b \0(\0"k rA\x80\x81\x82\x84xqA\x80\x81\x82\x84xG\r\0@A\x80\x82\x84\b A\xAC\xD8\xB0\xE1s"k rA\x80\x81\x82\x84xqA\x80\x81\x82\x84xG\r \0(! \0Aj"!\0 A\x80\x82\x84\b krA\x80\x81\x82\x84xqA\x80\x81\x82\x84xF\r\0\v\f\v \0!\v@ "\0-\0\0"E\r \0Aj! A,G\r\0\v\v \0A\0 \0-\0\0A,F\x1B\v\xFD\v\x7F~|@ \0E\r\0 \0)\0"B\x07\x83BR\r\0 B\b\x88\xA7"E\r\0 \0(\b!@ ("E\r@@A\x80\b"\x07E@A\0!\x07\f\v \x07 6 \x07 6\0A !\fA!@ \x07 Ak"Atj"\0(\0"\bE\r \0(!@@ \b)\0"B\x07\x83"B\x07Q@ E\r )\0"B\x07\x83B\x07R\r B\b\x88\xA7"\n B\b\x88\xA7G\r \nE\r Aj!A\0!	@A\0! )\0"B\x07\x83BQ@ (\b!\v \b)\0"B\x07\x83B\x07R\r E\r B\b\x88\xA7"E\r Aj"\vA ( )B\x83BR\x1Bj! 	Aj!	 B\b\x88\xA7! \b(\b!\0@@  \0(("\0(\0F@ \0(\b  \vE\r\v Ak"\r\f\x07\v\v \0("E\r  \fF@ \x07 At"\0E\r At!\f \0!\x07\v \x07 Atj"\0 \v6 \0 6\0A!\0 Aj! 	 \nG\r\0\v\f\v@ BR\r\0 E\r\0 )\0"B\x07\x83BR\r B\b\x88\xA7" B\b\x88\xA7G\r E\r Aj!\nA\0!A\0!\vA\0!@\x7FA\0 \b)\0"B\x07\x83BR\r\0A\0  B\b\x88\xA7O\r\0 \b(\b!\0@ E\r\0@ A\x07q"	E@ !\f\v  A\x07qk!A\0!@ \0(!\0 Aj" 	G\r\0\v\v A\bI\r\0@ A\bk"A\bq@ !\f\v \0((((((((!\0 A\bI\r\v@ \0((((((((((((((((!\0 Ak"\r\0\v\v \0(\v!	A\0!\0@ )\0"B\x07\x83BR\r\0  B\b\x88\xA7O\r\0 (\b B\x88\xA7ApqAjG@ \n!\0 E\r ! Aq"@  \vAqk!A\0!@ \0A \0(\b \0)\0B\x83BR\x1Bj!\0 Aj" G\r\0\v\v AI\r@ \0A \0(\b \0)\0B\x83BR\x1Bj"\0A \0(\b \0)\0B\x83BR\x1Bj"\0A \0(\b \0)\0B\x83BR\x1Bj"\0A \0(\b \0)\0B\x83BR\x1Bj!\0 Ak"\r\0\v\f\v \n Atj!\0\v  \fF@ \x07 At"E\r At!\f !\x07\v \x07 Atj" \x006  	6\0A!\0 \vAj!\v Aj! Aj! Aj" G\r\0\v\f\v BQ@ E\r )\0B\x07\x83BR\r \b(\b (\bE!\0\f\v@ BR\r\0 E\r\0 )\0"B\x07\x83BR\r@ B\xF4\x83BR\r\0 B\xF4\x83BR\r\0 \b)\b )\bQ!\0\f\vD\0\0\0\0\0\0\0\0!D\0\0\0\0\0\0\0\0!@@@@ \xA7A\xFFqAk\0\v \b+\b!\f\v \b)\b\xB9!\f\v \b)\b\xBA!\v@@@@ \xA7A\xFFqAk\0\v  +\ba!\0\f\v  )\b\xB9a!\0\f\v )\b\xBA!\v  a!\0\f\v BQ@ E\r )\0"B\x07\x83BR\r B\x83P B\x83B\0Rs!\0\f\v BR\r E\r )\0B\x07\x83BR\r\vA!\0\v \0A\0 \x1B\r\0\v \x07\x07 \0E\rA!\r\f\v \x07\x07\v Aj" G\r\0\vA\0\v \r\v\xCF?&\x7F~#\0A\xE0\0k"$\0@ \0 \0"A\0  "\x1BE@ @ B\x007 (!\0 (\f! B\x007\f ("@ \0  \0\0\v \0  \0\0\v E\r B\x007 (!\0 (\f! B\x007\f ("@ \0  \0\0\v \0  \0\0\f\v@@ (\0"E\r\0@A<\b"\0E\r\0 \0Ak-\0\0AqE\r\0 \0A\0A<*\v \0"E\r\0 \0B\x80\x83\x80\x80\x80\x80\x80\x8070 \0B\x80\x82\x80\x80\x80\x80\x80\x807 \0A\xF0\r)\x007\f \0A\xE8\r)\x007 \0Aj! \0 \f"\v\r \0(! \0(\f! B\x007\b B\x007\0 \0($"@@ (\0   \0\0"\r\0\v\v (8"@@ (\0   \0\0"\r\0\v\v   \0\0\v B\x007 (!\0 (\f! B\x007\f ("@ \0  \0\0\v \0  \0\0 B\x007 (!\0 (\f! B\x007\f ("@ \0  \0\0\v \0  \0\0\f\v  \v6\0 (\0!@ \v)\0B\x07\x83")B\x07Q@ E\r )\0B\x07\x83B\x07Q!\f\v )BR\r\0 E\r\0 )\0B\x07\x83BQ!\v\x7F@@@@\x7F@@   ("$A\0Gqr@A\x80\b!A\x80\b"\0@ \0A$;\0\0A!A\x80!\n\vA!\b\x7FA\0 -\0\f"AG\r\0A\x80\b"@A\xC0\0! A\0!\bA\0\f\vA\0!A\v"\r \0E" E"rr"\r (\b! (!\f ("A\xF6\b \x1B!! (!" -\0\r!# \v)\0B\x07\x83")B\x07Q@A\0! E@A\0!\r\f\b\v )\0B\x07\x83B\x07R@A\0!\r\f\b\v@ #@A\0!\r \v  "A\r\b \v  !A\0\r\b -\0\f\r\f\v E\r\v \bE@ !\f\v A\0"\r !A\f\vA\0! E@A\0!\r\f\x07\v )BR@A\0!\r\f\x07\v )\0")B\x07\x83BR@A\0!\r\f\x07\vA\0!\r $E\r A\x006  6\b  \v6 A6\0  )B\b\x88> \f\v@A\x80\b"\0E\r\0 \0A$;\0\0  \0 \v  "E\r\0  6\0 \0\x07\f\x07\v \0\x07A\0\f\x07\v  6  \v6\0A!A\0\f\v !A\0\v!\r  6\b  \v6 A\x006\0@ )\0")B\x07\x83B\x07Q@  6 A\x006\f  Aj6  )B\b\x88>\f\v B\x007 B\x007\f\v !\vA\xC0\0A\0 \x1B! Ak!% \fA\xA4\f \f\x1B!&  6$ A(j! \0!\vA\0!A!@ Aq@A!\f\v \rAq@A!\f\vA\0!A\0!\rA\0!@\x7F@@@@@@@@@@@  A(l"\x1Bj"\fA(k(\0\0\f\v \fAk"(\0" \fAk(\0O\r \fAk"(\0!  Aj6\0  Aj"A ( )B\x83BR\x1Bj6\0A\0!\b )\0")B\x07\x83BQ@ (\b!\b\v@@\x7F@@ \fA$k"(\0"E\r\0 )\0"*B\x07\x83B\x07R\r\0 \bE\r\0 *B\b\x88\xA7"E\r\0 )B\b\x88\xA7! (\b!@  (("(\0F@ (\b \b \vE\r\v Ak"\r\0\v\v  \f! (\0" \b\rA\0!\f\v ("\x07\r  \f! (\0\v! ((" (,F@  AE@A\0!\f\v (\0!\v  Aj6\0 E@A\0!\f\v  \b6\b  )B\x80\xFE\xFF\xFF\xFF\x83B\x847\0\v E\r	 E\r	 )\0")B\x07\x83B\x07R\r	 )\0B\x07\x83BR\r	 E\r	 ! )B\x80\xFE\xFF\xFF\xFF\x83B\0R@ (\b("\f(! \f 6\v  6  6  6\b  )B\x80|B\x80\xFE\xFF\xFF\xFF\x83 )B\xFF\x83\x847\0\f	\v \0 \fAk(\0"jA\0:\0\0  jAj!\f \n!@ "At!  \fI\r\0\v  \nF@ \v!	 \n! \0!\f\f\n\v \0 "	!\f 	\r	 \v!	 \n! \0!\fA\f\n\v \fA k(\0! \fA$k(\0!	@@@@@ $Ak\0\v@ E\r\0 )\0")B\x07\x83BR\r\0 )B\b\x88\xA7"E\r\0 Aj!@A (\b )\0B\x83BR\x1B!  \f!@ 	E\r\0 E\r\0 	)\0")B\x07\x83BR\r\0 	 )B\x80|B\x80\xFE\xFF\xFF\xFF\x83 )B\xFE\x83\x847\0 ! )B\x80\xFE\xFF\xFF\xFF\x83B\0R@ 	(\b"\b(! \b 6\v  6 	 6\b\v  j! \rAj"\r G\r\0\v\v\f\v@ E\r\0 )\0")B\x07\x83BR\r\0 )B\b\x88\xA7"E\r\0 Aj!A\0!@A (\b )\0B\x83BR\x1B!@ 	 (\r\0  \f! 	E\r\0 E\r\0 	)\0")B\x07\x83BR\r\0 	 )B\x80|B\x80\xFE\xFF\xFF\xFF\x83 )B\xFE\x83\x847\0 !\x07 )B\x80\xFE\xFF\xFF\xFF\x83B\0R@ 	(\b"\b(!\x07 \b 6\v  \x076 	 6\b\v  j! Aj" G\r\0\v\v\f\v \fA\fk"(\0" \fA\bk(\0O\r  Aj6\0A\0!\x07 E\r\x07 )\0")B\x07\x83BR\r\x07  )B\b\x88\xA7O\r\x07 Aj!\x07 (\b )B\x88\xA7ApqAjF\r E\rA\0! "Aq"@@ \x07A \x07(\b \x07)\0B\x83BR\x1Bj!\x07 Aj" G\r\0\v A|q!\v AI\r@ \x07A \x07(\b \x07)\0B\x83BR\x1Bj"A (\b )\0B\x83BR\x1Bj"A (\b )\0B\x83BR\x1Bj"A (\b )\0B\x83BR\x1Bj!\x07 Ak"\r\0\v\f\v \fA\fk"(\0!A\0!@ 	E\r\0 	)\0")B\x07\x83BR\r\0 )B\b\x88\xA7!\v  \fA\bk(\0"  K\x1B M\r  Aj"6\0\x7FA\0 	E\r\0A\0  M\r\0A\0 	)\0")B\x07\x83BR\r\0A\0  )B\b\x88\xA7O\r\0 	(\b!@ E\r\0A\0! ! A\x07q"\b@@ (! Aj" \bG\r\0\v Axq!\v A\bI\r\0@ A\bk"A\bq@ !\f\v ((((((((! A\bI\r\v@ ((((((((((((((((! Ak"\r\0\v\v (\v!\x07  M\r\b E\r\b )\0")B\x07\x83BR\r\b  )B\b\x88\xA7O\r\b Aj! (\b )B\x88\xA7ApqAjF\r E\rA\0! "Aq"@@ A (\b )\0B\x83BR\x1Bj! Aj" G\r\0\v A|q!\v AI\r@ A (\b )\0B\x83BR\x1Bj"A (\b )\0B\x83BR\x1Bj"A (\b )\0B\x83BR\x1Bj"A (\b )\0B\x83BR\x1Bj! Ak"\r\0\v\f\v\v \0 \fAk(\0"jA\0:\0\0A\0!\r Ak!\f\v \x07 Atj!\x07\f\v  Atj!\v\x7F@ \x07@ \0 \fAk(\0"\bjA\0:\0\0  60 \b A@kA A\xE6\f A0j"j"Aj! \n!@ "At!  I\r\0\v  \nF@ \v! \n! \0!\f\f\v \0 "!\f \r \v! \n! \b! \0!\fA\f\v  \f! 	E\r E\r 	)\0")B\x07\x83BR\r 	 )B\x80|B\x80\xFE\xFF\xFF\xFF\x83 )B\xFE\x83\x847\0 ! )B\x80\xFE\xFF\xFF\xFF\x83B\0R@ 	(\b"(!  6\v  6 	 6\b\f\v @ \b \fj A@k \xFC\n\0\0\v \f jA\0:\0\0A\0\v!@@ \x07)\0B\x07\x83B\x07R\r\0 )\0B\x07\x83B\x07R\r\0@ #E\r\0 \x07  "A\r \x07  !A\0E\r\0\f\v  F@  A\xD0\0l"\0E@A!A! \f!\0\f\r\v At! \0!\v  \x1Bj"\0 6\b \0 \x076 \0A\x006\0@ )\0")B\x07\x83B\x07Q@ \0 6 \0A\x006\f \0 Aj6 \0 )B\b\x88>\f\v \0B\x007 \0B\x007\f\v Aj! \0 6$\f\v   \x07  !\n 	E\r\0 \nE\r\0 	)\0")B\x07\x83BR\r\0  )B\b\x88\xA7"\0O\r\0 \0AO@ 	(\b! !\0 A\x07q"\v@@ "(! \rAj"\r \vG\r\0\v  \vk!\0\v@ A\x07I\r\0 \0A\x07k"\vA\bqE@ ((((((("(! \vA\bI\r \0A\bk!\0\v@ \0AG ((((((((((((((("(! \0Ak!\0\r\0\v\v  \n6 \n (6A\0!\r  	(\bG\r 	 \n6\b\f\v \n \n6 	 \n6\b\v !\v !\n \f!\0\f\v \x07)\0")B\x07\x83B\x07R\r\0 \x07Aj! )B\b\x88\xA7! &!@@\x7F \'"@  k\f\v \v"E\r\0@ -\0\0A F@ Aj! Ak"\r\f\v\v@  jAk-\0\0A F@ Ak"\r\f\v\v !\b "E\r\0@ \b(\0 F@ \b(\b  \vE\r\v \bAjA \b( \b)B\x83BR\x1Bj!\b Ak"\r\0\v\v Aj! \r\0\v\v 	 \x07(\r  \x07\f! 	E\r E\r 	)\0")B\x07\x83BR\r 	 )B\x80|B\x80\xFE\xFF\xFF\xFF\x83 )B\xFE\x83\x847\0 ! )B\x80\xFE\xFF\xFF\xFF\x83B\0R@ 	(\b"(!  6\v  6 	 6\b\f\v 	E@  \x07\f\f\v@ 	)\0")B\x07\x83BR\r\0 )B\b\x88\xA7"E\r\0 \bAj! 	(\b!A\0!@ ("E\r@ )\0")B\x07\x83B\x07R\r\0 )B\b\x88\xA7"E\r\0 (\b!\r@@ \r(("\r(\0 F@ \r(\b  \vE\r\v Ak"\r\f\v\v \r("E\r\0@@ (\0"A\xF7qAG"\'\r\0 )\0B\xF7\x83BR\r\0 )\b \b)R\r\f\v\x7F A\x07qAF@ )\0")B\x07\x83BR@ (\b\f\v (\b \b(\r\f\v )\0!)A\0\v!A\0!\r )\xA7"(A\x07qAF@ \b(!\r\v@ E\r\0 (A\xF7qAG\r\0  \b)7 A@k"AA\x9F\f Aj  \r\f\v \'A \r\x1B@ A\0! !@ E\r\0 E\r\0   \x07 \x07\r\f\v \x07 \x07\f\v  )\b7  A@k"AA\x9F\f A j \r \r\v@ #E\r\0 )\0B\x07\x83B\x07R\r\0 \x07)\0B\x07\x83B\x07R\r\0  \x07 "A@A\0!\r\f\vA\0!\r  \x07 !A\0\r\v \0 \fAk(\0"\fjA\0:\0\0  6\0 \f A@kA A\xE6\f "j"Aj! \n!@ "At!  I\r\0\v\x7F@  \nF@ \v!\b \n! \0!\f\v \0 "\b! \b\r\0 \v!\b \n! \f! \0!A\f\v @  \fj A@k \xFC\n\0\0\v  jA\0:\0\0A\0\v!  F@  A\xD0\0l"\0E@A!A\0!\r !\0A!\f\v\v At! \0!\v  \x1Bj"\0 \x076\b \0 6 \0A\x006\0@ \x07)\0")B\x07\x83B\x07Q@ \0 \x076 \0 6 \0A\x006\f \0 )B\b\x88>\f\v \0B\x007 \0B\x007\f\v Aj! \0 6$A\0!\r \b!\v !\n !\0\f\v Aj" G\r\0\v\vA\0!\r  \x07\f"E\r\0 	)\0")B\x07\x83BR\r\0 	 )B\x80|B\x80\xFE\xFF\xFF\xFF\x83 )B\xFE\x83\x847\0 ! )B\x80\xFE\xFF\xFF\xFF\x83B\0R@ 	(\b"(!  6\v  6 	 6\b\vA\0!\f\v \f jA.:\0\0 Aj!\0 @ \0 \fj \b \xFC\n\0\0\v \f \0 j"jA\0:\0\0A\0\v!@@@@@~@@  %K@  	 \x07  ! (\0!@ (("\0 (,F@  AE@A\0!\0\f\v (\0!\0\v  \0Aj6\0 \0E@A\0!\0\f\v \0 \b6\b \0 )B\x80\xFE\xFF\xFF\xFF\x83B\x847\0\v E\r \0E\r )\0")B\x07\x83B\x07R\r \0)\0"*B\x07\x83BR\r )B\b\x88\xA7"\x07E\r *B\b\x88\xA7!\b (\b!\rA\0!A\0!@ \r("\n("\v@ Aj!@@ \v(\0 \bG\r\0 \v(\b \0(\b \b\v\r\0 \v((! E rAqE@  6 \v 6A!\f\v  \x07F@  \r6\b \r(!\n\v  )B\xFF\x83 \x07Ak"\x07\xADB\b\x86\x84")7\0 \n 6\f\v \v!\r !\v  \x07I\r\v\v E\r Aq\r \x07E\r (\b("(!  \x006 \x07Aj\xADB\b\x86\f\v\x7F -\0\fAF@A\0!@@@ @@ \x07  Atj"\0(\0F@ \0( F\r\v Aj" G\r\0\v\v   G\r   At"\0\r  !A\f\v \r\b\f	\v  At!  \0!\v  Atj"\0 6 \0 \x076\0 Aj!\vA\0\v!\r@@@@@@ \x07)\0B\x07\x83B}"*BV\r\0 *\xA7AF@ )\0B\x07\x83B\x07R\r@ #E\r\0 \x07  "AE@ \x07  !A\0E\r\v\f\x07\v (\0E\rA\0! \x07A\0!\0 !@ \0E\r\0 E\r\0 \f \0  (\0\0!\v \0\x07 \x07 E\r  !\0 \x07 \0E\r  \0(\0\f! \0B\x007 \0(! \0(\f!\n \0B\x007\f \0("\v@  \v \n\0\0\v  \0 \n\0\0@ E\r\0 (\0!\x07@ (("\0 (,F@  AE@A\0!\0\f\v (\0!\0\v  \0Aj6\0 \0E@A\0!\0\f\v \0 \b6\b \0 )B\x80\xFE\xFF\xFF\xFF\x83B\x847\0\v \x07E\r\0 \0E\r\0 \x07)\0")B\x07\x83B\x07R\r\0 \0)\0"+B\x07\x83BR\r\0B\x80!*@ )B\b\x88\xA7"\nE@ \0!\f\v +B\b\x88\xA7! \x07(\b!\bA\0!A\0!\v@ \b("("@ Aj!@@ (\0 G\r\0 (\b \0(\b \v\r\0 ((!\x1B \vAqE@  \x1B6  6A!\v\f\v  \nF@ \x07 \b6\b \b(!\v \x07 )B\xFF\x83 \nAk"\n\xADB\b\x86\x84")7\0  \x1B6A!\v\f\v ! !\b\v  \nI\r\v\v \vAq\r \nE@ \0!\f\v \x07(\b("(!  \x006 \nAj\xADB\b\x86!*\v  6 \0 6 \x07 )B\xFF\x83 *\x847\0 \x07 \x006\b\v\f\v )\0"*B\x07\x83BR\r\0 $E\r\0A!  F@  A\xD0\0l"\0E\r At! \0! )\0"*B\x07\x83BQ!\v  \x1Bj"\0 6$ \0A\x006 \0 6\b \0 \x076 \0A6\0 \0 *B\b\x88\xA7A\0 \x1B6  Aj!\f\f\v  	 \x07  ! (\0!\x07@ ((" (,F@  AE@A\0!\f\v (\0!\v  Aj6\0 E@A\0!\f\v  \b6\b  )B\x80\xFE\xFF\xFF\xFF\x83B\x847\0\v@ \x07E\r\0 E\r\0 \x07)\0")B\x07\x83B\x07R\r\0 )\0"*B\x07\x83BR\r\0~@ )B\b\x88\xA7"\n@ *B\b\x88\xA7! \x07(\b!\bA\0!A\0!\v@ \b("("\0@ Aj!@@ \0(\0 G\r\0 \0(\b (\b \v\r\0 \0((!\x1B E \vrAqE@  \x1B6 \0 6A!\v\f\v  \nF@ \x07 \b6\b \b(!\v \x07 )B\xFF\x83 \nAk"\n\xADB\b\x86\x84")7\0  \x1B6\f\v ! \0!\b\v  \nI\r\v\v E\r \vAq\r \nE\r \x07(\b("\0(! \0 6 \nAj\xADB\b\x86\f\v E\r\v !B\x80\v!*  6  6 \x07 )B\xFF\x83 *\x847\0 \x07 6\b\v\f\v  G@ !\f\v  A\xD0\0l"\r\vA! \f!\0A!\f\v At!\v  \x1Bj"\0 6\b \0 \x076 \0A\x006\0 Aj!@ )\0")B\x07\x83B\x07Q@ \0 6 \0A\x006\f \0 A j6 \0 )B\b\x88>\f\v \0B\x007 \0B\x007\f\v \0 6$ !\f\x07\v E@A\0! \f jA\0:\0\0 	!\v\f\b\vA!\f\v E\r\v \0!B\x80\v!*  6 \0 6  )B\xFF\x83 *\x847\0  \x006\b\v E\r\vA!A\0!\r\f\v \f jA\0:\0\0A\0!\r 	!\vA\0!\f\v 	!\v !\n ! \f!\0\f\v !\n \f!\0\v \r\0\v\f\v  r!\v \x07 \0\x07 -\0\fAF@ \x07\vA\0  \rr rAq\r (\0!\v (8"\0E@ A\0\f\vA\0! \0!@  (AnjAk! \0 F@ (, ((kAhm j!\v (\0"\r\0\v  \v! (! (\f! B\x007\b B\x007\0 ($"@@ (\0   \0\0"\r\0\v\v (8"@@ (\0   \0\0"\r\0\v\v   \0\0 B\x007 (!\0 (\f! B\x007\f ("@ \0  \0\0\v \0  \0\0 B\x007 (!\0 (\f! B\x007\f ("@ \0  \0\0\v \0  \0\0\v A\xE0\0j$\0 \v\xF0\x7F~@ E\r\0 \0 :\0\0 \0 j"Ak :\0\0 AI\r\0 \0 :\0 \0 :\0 Ak :\0\0 Ak :\0\0 A\x07I\r\0 \0 :\0 Ak :\0\0 A	I\r\0 \0A\0 \0kAq"j" A\xFFqA\x81\x82\x84\bl"\x006\0   kA|q"j"Ak \x006\0 A	I\r\0  \x006\b  \x006 A\bk \x006\0 A\fk \x006\0 AI\r\0  \x006  \x006  \x006  \x006\f Ak \x006\0 Ak \x006\0 Ak \x006\0 Ak \x006\0  AqAr"k"A I\r\0 \0\xADB\x81\x80\x80\x80~!  j!@  7  7  7\b  7\0 A j! A k"AK\r\0\v\v\v\xB7\x7F| \0At"A\xD0\x84j! A\xF0\x84j+\0"D\0\0\0\0\0\0\0\0b@  +\0"\xA5" \xA1\xFC\x07 \xFC\x07\x80B|\xBA \xA2 \xA0" \xA1!\v  9\0 \0 \0@A\xB4\x84(\0A\x1BAA \0AF\x1B \0AF\x1B"\0Ak"vAq@A\xBC\x84A\xBC\x84(\0A tr6\0\f\v \0At(\xC0z"@ \0 \0\v\v\v\xA6\x7F \0(T"(\0! (" \0( \0("\x07k"  I\x1B"@  \x07 \x1B  (\0 j"6\0  ( k"6\v    K\x1B"@   \x1B  (\0 j"6\0  ( k6\v A\0:\0\0 \0 \0(,"6 \0 6 \v\r\0 \0A\x80j\0\v\0\0\v\0 \x07\v\b\0  \v\0 \b\v\0A\xF4\f\v\v\0 \0@ \0\x07\v\v\xF9\f\x7F#\0A0k"\0$\0 \0B\x007( \0B\x007  \0B\x007 \0B\x007 \0B\x007\bA\x9C\x84(\0E@A\xA8\x84B\x7F7\0A\xA0\x84B\x80\xA0\x80\x80\x80\x807\0A\x9C\x84#\0AkApqA\xD8\xAA\xD5\xAAs6\0A\xB0\x84A\x006\0A\x80\x84A\x006\0\vA\xDC\x80(\0"	@A\x84\x84!A!A\xD0\x80(\0"\nA(j"!@ (\0"\x07A\b \x07A\bjA\x07q"kA\0 \x1Bj! \x07 (j!\v@@  	F\r\0  \vO\r\0 ("A\x07F\r\0 Axq"\bA\0 AqAF"\x1B j!  \bj!  j!  \bj" \x07O\r\v\v (\b"\r\0\v \0 6\f \0 6\b \0A\xF4\x83(\0" k6A\xF8\x83(\0! \0 \n6, \0 6( \0  k6$ \0 6\v \0($ \0A0j$\0\vn\x7F#\0A k"\n$\0@ \0E\r\0 E\r\0 \n \b6 \n \x076 \n 6 \n 6\f \n 6\b \n 	6 \n A\0G:\0 \n A\0G:\0 \0  \nAj)!\v\v \nA j$\0 \v\vn\x7F#\0A k"	$\0@ \0E\r\0 E\r\0 	 \b6 	 \x076 	 6 	 6\f 	 6\b 	A\x006 	 A\0G:\0 	 A\0G:\0 \0  	Aj)!\n\v 	A j$\0 \n\v\0#\0\v\0#\0 \0kApq"\0$\0 \0\v\0 \0$\0\v\0\v\v\xBBq?\0A\x80\b\v\xF1failed to allocate memory\0-+   0X0x\0-0X+0X 0X-0x+0x 0x\0no digit after decimal point\0unexpected content after document\0updatedAt\0no digit after exponent sign\0no digit after sign\0nan\0null\0unexpected control character in string\0invalid utf-8 encoding in string\0invalid UTF-8 encoding in string\0no low surrogate in string\0invalid low surrogate in string\0invalid high surrogate in string\0invalid escape in string\0invalid escaped sequence in string\0inf\0true\0unexpected character, expected a JSON value\0false\0number is infinity when parsed as double\0%lld\0id\0number with leading zero is not allowed\0unexpected end of data\0[%zu]\0NAN\0INF\x000.2.0\0.\0(null)\0invalid literal, expected \'null\'\0invalid literal, expected \'true\'\0invalid literal, expected \'false\'\0\0\0\0\0\0\0\0\0A\x89\v\f\f\b\b\f\0A\xA0\v`#\0\0A\xC2\v\b\0A\xE1\v\b\b\b\0A\xEF\v\b\0A\x80\v\x80\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\0\x07\b	\xF0\xF0\xF0\xF0\xF0\xF0\xF0\n\v\f\r\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\n\v\f\r\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\xF0\0A\xAB\v\0\0\0A\xC5\v\b\0A\xE5\v\b\0A\x86\v\xB2,\xF0?\0\0\0\0\0\0$@\0\0\0\0\0\0Y@\0\0\0\0\0@\x8F@\0\0\0\0\0\x88\xC3@\0\0\0\0\0j\xF8@\0\0\0\0\x80\x84.A\0\0\0\0\xD0cA\0\0\0\0\x84\xD7\x97A\0\0\0\0e\xCD\xCDA\0\0\0 _\xA0B\0\0\0\xE8vH7B\0\0\0\xA2\x94mB\0\0@\xE5\x9C0\xA2B\0\0\x90\xC4\xBC\xD6B\0\x004&\xF5k\fC\0\x80\xE07y\xC3AC\0\xA0\xD8\x85W4vC\0\xC8Ngm\xC1\xABC\0=\x91`\xE4X\xE1C@\x8C\xB5x\xAFDP\xEF\xE2\xD6\xE4KD\x92\xD5M\xCF\xF0\x80D\0\0\0\0\0\0\0\0\xAE\xDE/\xA8\xAB\xDC)\xBF3\xFC\x808\x87\xEE2tZ\xD6;\x92\xD6S\xF4\xEE?;\xA1)\xAA?\xF8ee\x1Bf\xB4X\x95\x07\xC5$\xA4Y\xCA\xC7Jv\xBF>\xA2\x7F\xE1\xAE\xBAI\xF6-\r\xF0\xBCy]So\xCE\x8A\xDF\x99Z\xE9\xDCsy,,\xD8\xF4\x94\xC1\xB6+\xA0\xD8\x91i\xE8K\x8A\x9B\x1B\x07y\xF9Fq\xA46\xC8N\xB6\x84\xE2\xDEl\x82\xE2H\x97\xB7\x98\x8DMDz\xE2\xE3%\x9B\b#\x1B\x1B\xFDr\x7Fx\xB0j\x8Cm\x8E\xF7 \xE5\xF5\xF00\xFEO\x9F\x96\\\x85\xEF\b\xB25\xA9Q^3-\xBD\xBD#G\xBC\xB3f+\x8B\xDE\x82\xE65\x80x,\xADv\xACU0 \xFB\x8B1\xCC\xAF!P\xCB;L\x93k<\xE8\xB9\xDC\xAD=\xBF\x1B*$\xBEJ\xDFx\xDD\x85Kb\xE8S\xD9\r\xAF\xA24\xADm\xD7k\xAA3o=q\xD4\x87h\xAD\xE5@\x8Cdr\x86\x95\0\xCB\x8C\x8D\xC9\xA9\xC2Q\xAF\xFDhH\xBA\xC0\xFD\xEF\xF0;\xD4\xF2\xDEf%\x1B\xBDmt\x98\xFE\x95v\xA5\x84WK`\xF70\xB6K\x88\x91>~;\xD4\xCE\xA5-^85\xBD\xA3\x9EA\xEA5\xCE]J\x89B\xCF\xB9u\x86\x82\xACLR\xB2\xE1\xA0z\xCE\x95\x89\x81\x93	\x94\xD1\xEB\xEFCsIB\xFB\xEB\xA1\xF8\v\xF9\xC5\xE6\xEB\xA6`\x9B\x9F\xFAf\xCA\xF6Nww\xE0&\xD4\xD08\x82G\x97\xB8\0\xFD\xB4"U\x95\x98\xB0 \x89\x82c\xB1\x8C^s \x9E\xB05U]_n\xB4Ub\xBC\xDD/6\x90\xA8\xC5\x83\xAA4\xF7\x89!\xEB{+\xD5\xBBC\xB4\xF7\xE4#\xD5u\xEC\xE9\xA5-;eU\xAA\xB0k\x9An6%!\xC93\xB2G\xF8\x89\xBE\xEA\xD4\x9C\xC1\n\x84ni\xBB\xC0\x9E\x99v,n%\nDH\xF1\r%\xCAC\xEAp\xC0\xCA\xDBdW\x86*\xCD\x96(W^j\x928\xBC>\xED\'u\x80\xBC\xF2\xEC\xF57\b\xC6k\x97\x8D\xE8q\x92\xA0\xEB.h3\xC6DJ\x86\xF7\xA3~X1\x87[D\x93!\xE0\xFBj\xEE\xB3zL\x9E\xAE\xFDhr\xB8d)\xD8\xBA\xEA`Y\xDFE=\xCF\xE6\xBD3\x8E)\x87$\xB9o\xABk0b\xC1\xD0\x8FV\xE0\xF8y\xD4\xB6\xD3\xA5\x96\x86\xBC\x87\xBA\xF1\xC4\xB3lw\x98\x89\xA4H\x8F<\xA8\xAB)).\xB6\xE0\x87\xDE\x94\xFE\xAB\xCD3%I\v\xBA\xD9\xDCq\x8C\v\x7F\x8B\xC0\xF0\x9Fo\x1B\x8E(T\x8E\xAF\xD9M\xE4^\xAE\xF0\xEC\x07J\xA2\xB12\xE9q\xDBPa\x9D\xF6\xD9,\xE8\xC9n\xAF\x9F\xAC1\'\x89\xD2\\":\b1\xBE\xCA\xC6\x9A\xC7\xFEp\xAB\xF4\xAAH\nc\xBDm}x\x81\xB9\x9D=M\xD6\b\xB1\xD5\xDA\xCC\xBB,	N\xEB\xF0\x93\x82F\xF0\x85\xA5\x8E\xC5\b`\xF5\xBB%!&\xED8#Xl\xA7N\xF2\xF6\n\xB8\xF2*\xAF\xAAo(\x07,nG\xD1\xE1\xAE\xB4\rf\xAF\xF5\xCAEy\x84\xDB\xA4\xCC\x82M\xED\x90\xC8\x9F\x8D\xD9P<\x97\x97e\xCE\x7F\xA3\xA0(\xB5\xBA\x07\xF1\xE5\f}\xFD\xFE\x96\xC1_\xCC\xC8rb\xA9I\xEDSO\xDC\xBC\xBE\xFC\xB1w\xFFz\xBB\x9C\xE8\xE8%\xB1	6\xF7=\xCF\xAA\x9F\xAC\xE9T\x8Ca\x91\xB1w\x8Cu\r\x83\x95\xC7$j\xEF\xB9\xF5\x9D\xD5%oD\xD2\xD0\xE3z\xF9\xADDk(sKw\xC5j\x83b\xCE\xEC\x9B2\xEC\nC\xF9g\xE3N\xD5vE$\xFB\xE8\xC2?\xA7\xCD\x93\xF7A\x9C"\x8A\xD4V\xEDy\xA2\xF3\xC1xuRCk\xD6DV4\x8CAE\x98\xA9\xAAxk\x89\n\x83\f\xD6kA\xEF\x91V\xBES\xD5V\xC6k\x98\xCC#\x8F\xCB\xC6k6\xEC\xED\xA8\x8A\xEC\xB7\x86\xBE\xBF,9?\xEB\xA2\xB3\x94\xA9\xD6\xF32\xD7\xF7{\x07O\xE3\xA5\x83\x8A\xE0\xB9S\xCC\xB0?\xD9\xCC\xF5\xDA\xC9"\\\x8F$\xADX\xE8h\xFF\x9C\x8F@\xB3\xD1\xBE\x95\x99\xD96l7\x91\xA1\xC2\xB9	\b#-\xFB\xFF\x8FDG\x85\xB5\x8A\xA72(\f\n\xD4\xAB\xF9\xF9\xFF\xB3\x99\xE6\xE2lQ?2\x8F\f\xC9;\xFC\x7F\x90\xAD\xD0\x8D\xE3\x92g\x7F\xD9\xA7=\xAEJ\xFB\x9F\xF4\x98\'D\xB1\x9CwA\xDF\xCF\xCD\x99\xFA\xC71\x7F1\x95\xDD\x83\xD5\xD7CV@@R\xFC\x7F\xEF>}\x8Ar%kf\xEA5(Hf;\xE4^\xAB\x8E\xAD\xCF\xEE\0eC2\xDA@J\x9D6V\xB2c\xD8\x82j\x07@>\xD4\xBE\x90hN"\xE2uO>\x87\x91\xA2\xE8\xA6DwZ\xE2\xAAZS\xE3\r\xA96\xCB\xA2\xD0q\x83\x9AU1(\\Q\xD3>\x87\xCAD[Z\r\x91\x80\xD5\x99\xD9\x84\xC2\x86\x94\xFE\nyX\xE8\xB6\xE0\x8Af\xFF\x8F\xA5r\xA89\xBEM\x97nb\xE3\x98-@\xFFs]\xCE\x8F\xC8-!=\n\xFB\x8E\x7F\x88\x7Fh\xFA\x80\x99\v\x9D\xBC4f\xE6|r\x9F#j\x9F9\xA1\x80N\xC4\xEB\xC1\xFFN\x87\xACDGC\x87\xC9 b\xB5f\xB2\xFF\'\xA3"\xA9\xD7\xE9\xFB\xA8\xBAb\0\x9F\xFF\xF1K\xB5\xC9\xA6\xAD\x8F\xACq\x9D\xA9\xB4=`\xC3?wo"|\x99\xB3\xCE\xC4\xD3!M8\xB4U\xCB+\x9BT\x7F\xA0\x9D\xF6Hj`F\xA1S*~\xFB\xE0\x94O\x84\xC1\x99mB\xFC\xCBDt\xDA.9zc%C1\xC0\bS\xFB\xFEU\x91\xFA\x88\x9FX\xBC\xEE\x93=\xF0\xCA\'\xBA~\xABU5y\xB5c\xB75u|&\x96\xDEX4/\x8BU\xC1K\xA2<%\x83\x92\x1B\xB0\xBBo\xFB\xED\xAA\xB1\x9E\xCB\x8B\xEE#w"\x9C\xEA\xDC\xCA\xC1y\xA9^F_uv\x8A\x95\xA1\x92\xC9\xEC\x89\xCD\xFA\v6]\xED\xFAI\xB7{fg\xEC\x80\xF9\xCE\x84\xF4Y\xA8y\xE5@\xE7\x80\'\xE1\xB7\x82\xD2X\xAE7	\xCC1\x8F\x88\x90\xB0\xB8\xEC\xB2\xD1\x07\xEF\x99\x85\v?\xFE\xB2\xAA\xB4\xDC\xE6\xA7\x86\xC9j\0g\xCE\xCE\xBD\xDF\x9A\xD4\xE1\x93\xE0\x91\xA7g\xBDB`\0A\xA1\xD6\x8B\xE0$m\\,\xBB\xC8\xE0mSx@\x91I\xCC\xAEn\x88s\xF7\xE9\xFAXHh\x96\x90\xF5[\x7F\xDA\x9E\x89jPu\xA49\xAF-^zy\x99\x8F\x88\x96BR\xC9\x84mx\x81\xF5\xD8\xD7\x7F\xB3\xAA\x83;\xD3\xA6{\b\xE5\xC8\xD6\xE12\xCF\xCD_`\xD5d\n\x88\x90\x9AJ\xFB&\xCD\x7F\xA1\xE0;\\\x85\x7FU\x9A\xA0\xEE\xF2\\o\xC0\xDF\xC9\xD8J\xB3\xA6H\xEA\xC0H\xAA/\xF4\x8B\xB0W\xFC\x8E`\xD0&\xDA$\xF1\xDA\x94;\xF1W\xCE\xB6]y<\x82X\b\xB7\xD6\b=\xC5v\xED\x81$\xB5\xCB\xA2n\xCAd\fK\x8CvTh\xA2m\xA2\xDD\xDC}\xCB	\xFD}\xCF]/\x94\xA9\v	\vT]\xFEL|]C5;\xF9\xD3\xE1\xA6\xE5&\x8DT\xFA\x9E\xAFmJ\xC5{\xC4\x9A\x9Fp\xB0\xE9\xB8\xC6\x1B	\xA1\x9CA\xB6\x9A5\xC0\xD4\xC6\x8C$g\xF8bK\xC9\xD2c\xC3\xF8D\xFC\xD7\x91v@\x9B\xCF]Bc\xDE\xE0y6V\xFBM6\x94\xC2\xE4B\xF5\xFCY\x98\xC4+z\xE1C\xB9\x94\xF2\x9D\x93\xB2{[o>Z[\xECl\xCA\xF3\x9C\x97B\x9C\xCF\xEE,\x99\xA71r\'\b\xBD0\x84\xBDS\x83\x83*x\xFF\xC6P\xBDN1J\xEC<\xE5\xEC(d$5V\xBF\xF8\xA46\xD1^\xAEF\x94\x99\xBE6\xE1\x95w\x1B\x87\x84\x85\xF6\x99\x98\xB9?n\x84Y{U\xE2(\xE5&t\xC0~\xDDW\xE7\xCF\x89\xE5/\xDA\xEA3O\x98H8o\xEA\x96\x90!v\xEF]\xC8\xD2\xF0?c\xBEZ\v\xA5\xBC\xB4\xA9Skuz\x07\xED\xFBm\xF1\xC7M\xCE\xEB\xE1\x94(\xC6YI\xE8\xD3\xBD\xE4\xF6\x9C\xF0`3\x8D\\\xD9\xBB\xAB\xD7-qd\xEC\x9D4\xC4,9\x80\xB0\xB3\xCF\xAA\x96My\x8D\xBDg\xC5A\xF5wG\xA0\xDC\xA0\x83U\xFC\xA0\xD7\xF0\xEC`\x1BI\xF9\xAA,\xE4\x89Dr\xB5\x9D\xC4\x86\xF49b\x9B\xB7\xD57]\xAC\xD5\xCE"\xC5u(1\xC7:\x82%\xCB\x85t\xD7\x8B\x82k6\x932c}\xBCdq\xF7\x9E\xD3\xA8\x86\x971\x9C\xFF]\xAE\xEB\xBDM\xB5\x86\bS\xA8\xFC\xFD\x83\x83\x7F\xF5\xD9f-\xA1b\xA8\xCAg\xD2{\xFD$\xC3c\xDFr\xD0`\xBC\xA4=\xA9\xDE\x80\x83m\xF7Y\x9E\xCBGBx\xEB\r\x8DSa\xA4\b\xE6t\xF0\x85\xBE\xD9RVfQp\xE8[y\xCD\x8B\x92l\'.\x90g\xF6\xDF2Fq\xD9k\x80\xB6S\xDB\xA3\xD8\xBA\0\xF3\x97\xBF\x97\xCD\xCF\x86\xA0\xA4(\xD2\xCC\xA4\xE8\x80\xF0}\xAF\xFD\xC0\x83\xA8\xC8\xCD\xB2\x80\xCD"al]\x1B=\xB1\xA4\xD2\xFA\x81_\b W\x80kyc1\xC6\xEE\xA6\xC3\x9C\xB0;t60\xE3\xCB\xFC`\xBDw\xAA\x90\xF4\xC3\x9C\x8AD\xFC\xDB\xBE;\xB9\xAC\xD5\xB4\xF1\xF4D-HU\xFB\x92\xEE\xC5\xF3\x8B-\x99JM-\xDD\x1Bu\xB6\xF0\xEExF\xD5\\\xBF]c\xA0xZ\xD4b\xD2\xE4\xAC*\x98\n4\xEF4|\xC8q\x89\xFB\x86\xACz\x9F\x86\x80\x95\xA0M=\xAE\xE65]\xD4W\xD2F\xA8\xE0\xBA	\xA1\xCCY`\x83t\x89\xD7\xAC\x9F\x86X\xD2\x98\xE9K\xC9?p8\xA4\xD1+\xCC#Tw\x83\xFF\x91\xCF\xDD\'F\xA3c{\b\xBF,)Ud\x7F\xB6B\xD5\xB1L\xC8;\xCA\xEEwsj=\xE4\x93J\x9E_\xBA\xCA >\xF5*\x88b\x86\x93\x8E\x9C\xEE\x82r{\xB4~T\x8D\xB25*\xFBg8\xB2C\xAA#O\x9Aa\x9E\xE91\xC3\xF4\xF9\x81\xC6\xDE\xD4\x94\xEC\xE2\0\xFAd~\xF3\xF98<<\x8B\xDD\xD3\x8D@\xBC\x83\xDE^p8G\x8B\v\xAEE\xD4H\xB1P\xAB$\x96v\x8C\xEE\xDA\x8D\xD9W	\x9B\xDD$\xD6\xAD;\xC9\xA4\xCF\xD4\xA8\xF8\x87\xD6\xE5\x80\n\xD7\xA5L\xE5\xBC\x8D\n\xD3\xF6\xA9L!\xCDL\xCF\x9F^+ep\x84\xCC\x87t\xD4gi\0 \xC3Gv;?\xC6\xD2\xDF\xD4\xC8\x84s\xE0A\0\xF4\xD9\xEC)	\xCFw\xC7\n\xFB\xA5\x90XR\0qh\xF4\xCC\xC2U\xB9\x9D\xCCy\xCF\xB4\xEEf@\x8D\x82q\xBF\x99\xD5\x93\xE2\xAC\x810U@H\xD8L\xF1\xC6/\0\xCB8\xDB\'\xA2|jPZ\xA0\xAD\xB8;\xC0\xFD\xD2\xF1\x9C\xCA\x85\xE4\xF0\b\xD9\xA6J0\xBD\x88F.D\xFDc\xA6mJ\x8F\x90.>v\xEC\x9CJ\x9E\xFE\x872N\x8EY\x9A\xBA\xCD\xD3\'D\xDD\xC5\xFD)?\x85\xE1\xF1\xEF@(\xC1\x88\xE10\x95T\xF7|\xF4\x8E\xE6Y\xEE+\xD1\xB9x\xF5\x8C>\xDD\x94\x9A\xCEX0\xF8t\xBB\x82\xE7\xD620\x8E:\xC1\xAF<6Rj\xE3\xA1\x8C?\xBC\xB1\x99\x88\xF1\xC1\x9A\'\xCB\xC3\xE6D\xDC\xE5\xB7\xA7`\xF5\x96\xB9\xC0\xF8^:\xAB)\xDE\xA5\xDB\xB8\xB2\xBC\xE7\xF0\xB6\xF6H\xD4tV\xD6\x91f\xDF\xEB!\xADd4[I\x1B\x95\xC9%\xBB\xCE\x9Fk\x934\xEC\xBE\0\xD9\r\xB1\xCA\xFB;\xEFi\xC2\x87F\xB8B\xA7\xEE@OQ]=\xFA\nk\xB3)X\xE6Q*\xA3\xA5\xB4\f\xDC\xE6\xC2\xE2\xF7\x8F\xABr\xBA\xEA\x85\xE7\xF0G\x93\xA0s\xDB\x93\xE0\xF4\xB3Vieg!\xEDY\xB8\x88P\xD2\xB8\xF2\xE0,S\xC3>\xC1ih0sUr\x83sO\x97\x8C\xFB:\xC7BA\xCF\xEANdP#\xBD\xAF\xFA\x98\b\xF9\x9E\x92\xD1\xE5\x83\xA5b}$l\xAC\xDB9\xBFJ\xB7F\xF7E\xDFr\xA7]\xCE\x96\xC3K\x89\x83\xB7\x8E2\x8C\xBA\x8BkO\xF5\x81|\xB4\x9E\xABde2?/\xA9n\xA2Ur\xA2\x9Ba\x86\xD6\xBD\xFE\xFE{S\n\xC8\x85u\x87E\xFD\x866__\xE9,t\xBD\xE7R\xE9\x96A\xFC\x98\xA77\xB7#8H,\xA0\xA7\xA3\xFCQ;\x7F\xD1\xC5\xA5,\x86Z\xF7\xC4H\xE6=\x85\xEF\x82\xFB"\xE7\xDBsM\x98\x9A\xF5\xDA_\rXf\xAB\xA3\xBA\xEB\xE0\xD2\xD0`>\xC1\xB3\xD1\xB7\xEE?\x96\xCC\xA8&\x99\x07\xF9\x8D1\xC6\xE5\x94\xE9\xCF\xBB\xFFRp\x7FIFw\xF1\xFD\xD3\x9B\xFD\xF1a\xD5\x9F3\xA6\xEF\xED\x8B\xEA\xB6\xFE\xC8\x82S|n\xBA\xCA\xC7\xC0\x8Fk\xE9.\xA5d\xFE{ch\x1B\ni\xBD\xF9\xB0s\xC6\xA3z\xCE\xFD=->!Q\xA6a\x9CN\b\\\xA6\f\xA1\xBE\xB8\x8Di\xE5\xFA\x1B\xC3b\n\xF3\xCFOInH&\xF1\xC3\xDE\x93\xF8\xE2\xF3\xFA\xCC\xEF\xC3\xA3\xDB\x89Z\xB7v:k\\\xDBm\x98\xE0uZF)\x96\xF8e	\x863R\x89\xBE#X\xF1\x97\xB3\xBB\xF6\x7FY\x8Bg\xC0\xA6+\xEE,.X\xED}\xA0jt\xEF\xB7@8H\xDB\x94\xDCW\xB4N\xA4\xC2\xA8\xEB\xDD\xE4PF\xBA\xE4labM\xF3\x92f\xE5\xD7\xA0\x96\xE8\xC8\xF9\xBA \xB0w`\xCD2\xEF\x86$^\x91.\xDCt\xCE\n\xB8\x80\xFF\xAA\xA8\xAD\xB5\xB5\xBAV$\x92\x99\x81\r\xE6`\xBF\xD5#\xE3il\xED\x97\xF6\xFF\xE1\x8F\x9C\x97\xC5\xAB\xEF\xF5\x8D\xC1c\xF4\xFA?\x8D\xCA\xB3\x83\xFD\xB6\x96ks\xB1\xB2|\xB1\xA6\xF8\x8F0\xBD\xA0\xE4\xBCd|F\xD0\xDD\xDE\xDB]\xD0\xF6\xB3|\xAC\xE4\xF6\xBE\r,\xA2\x8Ak\xA9:Bz\xF0\xCDk\x9D\x92\xB3.\xB7J\xAD\xC6S\xC9\xD2\x98l\xC1\x86Dw`z\xD5d\x9D\xD8\xB7\xA8{\x07\xBF\xC7q\xE8\x8BJ|l_b\x87rI\xADd\xD7G-]\x9B\xC7\xC6\xF6:\xA9\xCF\x9B\xD8=\r\xE4\x98\xD5y4\x82yx\xB4\x89\xD3\xC3\xC2N\x8D\xFFJ\xCB`\xF1K\xCB6\x84\xBA9QX*r\xDF\xCE\xFE\xB8\xED\xFE\x94C\xA5(\x88e\xEE\xB4N\x97\xC2>\'\xA9\xA6=z\x94\xCE2\xEA\xFE)b"=s\x87\xB8)\x88f\xCC\x81_R?Z}5\b\xA8&4*\x80\xFFc\xA1\xF7&\xCF\xB0\xDC\xC2\x07\xCAR0\xC14`\xFF\xBC\xC9\xB5\xF0\xDD\x93\xB3\x89\xFCg|\xF1A8?,\xFC\xE2\xACC\xD4x \xAC\xBB\xC0\xED6)\x83\xA7\x9B\x9D\rL\xAA\x84K\x94K\xD51\xA9\x84\xF3c\x91\xC5\xDF\xD4e^y\x9E\n}\xD3e\xF0\xBC5C\xF6\xD5J\xFF\xB5FM.\xA4?\x96\xEA\x99EN\x8E\xBF\xD1\xCEKP9\x8D\xCF\x9B\xFB\x81d\xC0\xD6\xE1q/\x86\xC2^\xE4\x88p\xC3\x82z\xA2}\xF0LZN\xBB\'sv]U&\xBA\x91\x8C\x85N\x96o\xF8\xD5\xF8\x07j:\xEA\xAF(\xB6\xEF&\xE2\xBB\x8B6U\n\xF7\x89\x89\xE5\xDB\xB2\xA3\xAB\xB0\xDA\xEA.\x84\xEA\xCCt\xACE+o\xC9OFk\xAE\xC8\x92\x9D\x92\0\xC9\x8B\v;\xCB\xBB\xE3\xDAz\xB7D7@\xBBn\xCE	\xBD\xAA\xDC\x9D\x87\x90Y\xE5j\nB\xCC\xB6\xEA\xA9\xC2T\xFAW\x8F-#J\x82F\xA9\x9FdeT\xF3\xE9\xF8-\xB3\xF9\xAB\x96\xDC"\x98\x93G\xBD~)p$w\xF9\xDF\xF7V\xBC\x93+~xY6\xEF\xC6v\xEA\xFB\x8BZ\xB6U<\xDBN\xEBWk\xA0w\xE5\xFA\xAE\xF1#k\v\x92"\xE6\xED\xC4\x85\x88\x95Y\x9E\xB9\xDA\xED\xECE\x8E6\xAB_\xE9\x9BSu\xFD\xF7\xB4\x88\xB4\xEB\xCB\xDB\x81\xA8\xD2\xFC\xB5\xE1\xAA\xA1&\x9F\xC2\xBDR\xD6\xA2R\x07|\xA3D\x99\xD5_I\xF0F3m\xE7K\xA5\x93\x84-\xE6\xCA\x7F\x85\xDB-V\f@\xA4po\x8E\xB8\xE5\xB8\x9F\xBD\xDF\xA6R\xB9kP\xCDL\xCB\xB2&\xA7\x07\xAD\x97\xD0\xA7\xA7F\xA4\0 ~/xs\xC8$\xCC^\x82\xC8(\f\x8Cf\0\xD4\x8E;V\x90\xFA-\x7F\xF6\xA2\xFA2/\x80\0\x89r\xCAk4y\xF9\xB4\xCB\xB9\xFF\xD2:\xA0@+O\xBC\x86\x81\xD7\xB7&\xA1\xFE\xA8\xBF\x87I\xC8\xF6\xE26\xF4\xB0\xE62\xB8$\x9F\xC9\xD7\xF4-}\xCA\xD9\rC1]\xA0?\xE6\xED\xC6\xBB\rry=P\x91\x94}t\x88\xCF_\xA9\xF8*\x91\xCE\x97cL\xA4u|\xCEH\xB5\xE1\xDBi\x9B\xBA\xE1>\xBE\xAF\x86\xC9\x1B\x9B"\xDARD\xC2ha\x99\xCE\xAD[\xE8\xFB\xA2\xC2A\xAB\x90g\xD5\xF2\xC3\xB9?B\x99r\xE2\xFA\xA5	k\xBA`\xC5\x97\xD4g\xC9\x9F\x87\xCD\xDC`\xCB\xE9\xB8\xB6\xBD \xC9\xC1\xBB\x87\xE9\0T8>G#g$\xEDh;\xB2\xAA\xE9#)\v\xE3\x86\fv\xC06\x94!e\xAF\nr\xB6\xA0\xF9\xCE\x9B\xA8\x8F\x93pD\xB9i>[\x8D\xE4\b\xF8\xC2\xC2\x92s\xB8\x8C\x95\xE7\xB20\v\xB6\xB9\xB9;H\xF3w\xBD\x90\xC2Ho^+\xF2\xC6\xB1(\xA8J\xF0\xD5\xEC\xB4\xF3\v6\xB6\xAE82R\xDD l\v(\xE2\xB0\xE1\x8D\xC3c\xDA\xC6%_S\x8A\x94#\x07Y\x8D\xAD8Z~H\x9CW7\xE8\xACy\xECH\xAF\xB0Q\xD8\xC6\xF0\x9DZ\x83-D"\x98\'\x1B\xDB\xDCe\x8E\xF8lE1\xE4\xF8k\xBF\xF8\xF0\b\x8A\xFFX\x1Bd\xCB\x9E\x8E\x1B\xC5\xDA\xD2\xEE6-\x8B\xAC?/"=~Fr\xE2w\x91\x87\xAA\x84\xF8\xAD\xD7\xBBj\xCC\xD8[\xEA\xBA\x94\xEAR\xBB\xCC\x86\xE9\xB4\xC2\x9FG\xE9\x98\xA5\xE99\xA5\'\xEA\x7F\xA8$b\xB3G\xD7\x98#?d\x88\x8E\xB1\xE4\x9F\xD2\xAD:\xA0\r\x7F\xEC\x8E\x89>\xF9\xEE\xEE\xA3\x83\xAC$0h\xCFS+\x8EZ\xB7\xAA\xEA\x8C\xA4\xD7-<B\xC3\xA8_\xB611eU%\xB0\xCDMy\xCB\xF4\x927\xBF>_U\x8E\x80\xD0\v\xE4\xBE\x8B\xD8\xBB\xE2\xD6n\xB7*\x9D\xB1\xA0\xC4\x9D\xAE\xAE\xCEj[\x8B\n\xD2du\xDE\xC8uRDZZ\x82E\xF2.\x8D\xBE\x92\x85\xFBg\xD5\xF0\xF0\xE2\xD6\xEE=\xC4\xB6{s\xED\x9Ck`\x85\x96\xD6MFULu\xA4Z\xD0(\xC4\x86\xB8&<L\xE1\x97\xAA\xDFe\x92Mq3\xF5\xA8f0K\x9F\xD9=\xD5\xAB\x7F{\xD0\xC6\xE2?\x99)@\xFE\x8E\xA8F\xE5\x96_\x9A\x84x\xDB\x8F\xBF3\xD0\xBDrR\x98\xDE|\xF7\xC0\xA5V\xD2s\xEF@Dm\x8F\x85f>\x96\xAD\x9A\x98\'vc\xA8\x95\xA8J\xA4y\0\xE7\xDDY\xC1~\xB1S|\xBBR]\rX\xC0`U\xAFq\xDE\x9Dh\x1B\xD7\xE9\xA6\xB4n\xF0\xB8\xAA\r\x07\xABb!q&\x92\xE8p\xCA\x96\xB3\xCA\xD1\xC8U\xBBi\r\xB0\xB6"\r\xFD\xC5\x97{`=;+*\xC4\\\xE4jP|\xB7}\x9A\xB8\x8C\xE3[\x9Az\x8A\xB9\x8EB\xB2\xAD\x92\x8E`\xF3w\xC6\xF1@\xEDg\xB2\xD3Y7\xB28\xF0U\xA37.\x91_\xE8\xDF\x88f/\xC5\xDEFlk\xC6\xE2\xBC\xBA;1a\x8B\xA0=;K\xAC##w\x1Bl\xA9\x8A}9\xAE\b\r\n^\x97\xEC\xABU"\xC7S\xED\xDC\xC7\xD9!J\x90\x8C5\xBD\xE7\x96uu\\T\xEA\x88T.\xDAwA\xD6P~\xD2\x92si\x99$$\xAA\xE9\xB9\xD0\xD5\xD1\v\xE5\xDD\x87w\xD0\xC3\xBF-\xAD\xD4d\xE8DK\xC6N^\x95\xB4Jb\xDA\x97<\xEC\x84>\v\xEF;\xF1Z\xBDa\xDD\xFA\xD0\xBDK\'\xA6\x8E\xD5\xCD\xEA\x8A\xAD\xB1\xEC\xBA\x949E\xAD\xB1\xCF\xF2J\x81\xA5\xED\xDEg\xF4\xFCCK,\xB3\xCE\x81\xD7\xCEp\x87\x94\xCF\xEA\x801\xFC^\xF7_B\xA2\x8DM\xA9y\x83%\xA1>;\x9A5\xF5\xF7\xD2\xCA0C\xA0X\xE4n	\r\xCA\0\x83\xF2\xB5\x87\xFD\xFCS\x88n\x9D\xCA\x8BH~\xE0\x91\xB7\xD1t\x9E}4U\xCFd\xA2^w\xDA\x9DXv%\xC6\x9D\x81*\xFEJ6\x95Q\xC5\xEE\xD3\xAE\x87\x96\xF7"\xF5\x83\xBD\xDD\x83:R;uD\xCD\xBE\x9AB5yr\x96j\x92\xC4\'\x8A\x92\x95\0\x9Am\xC1\x93\x82<\xB7u\xB1,\xF7\xBA\x80\0\xC9\xF18c\xDD\x8B\xC6$S\xEE{\xDAtP\xA0\x97^\xCA\xEB\xFC\xF6\xD3\xEA\x92d\b\xE5\xBC\x84\xF5\xBC\xA6\xBB\xF4\x88\xA5a\x95\xB6}J\xEC\xE52l\xD0\xE3\xE91+\x07]\x92\x8E\xEE\x92\x93\xCF\x9FCb.2\xFF:I\xB4\xA462\xAAw\xB8\xC2\x87\xD4\xFA\xB9\xFE\xBE	[\xE1M\xC4\xBE\x94\x95\xE6\xB3\xA9\x89yh\xBE.L\xD9\xAC\xB0:\xF7|\x90\n\xF6K7\x9D\xD8\\	5\xDC$\xB4\x94\x8C\xF3\x9E\xC1\x84\x84S\xB4KB.\xE1\xB9o\xB0\xF2\xA5e(\xCB\x88Po	\xCC\xBC\x8C\xD3E.D\xB7\x87?\xF9\xFE\xAA$\xCB\v\xFF\xEB\xAFH\xD79\xA5i\x8F\xF7\xBE\xD5\xED\xBD\xCE\xFE\xE6\xDB\x1BM\x88ZDs\xB5\x97\xA5\xB46A_p\x8900\x95\xF8\x88\nh1\xFC\xCEa\x84w\xCC\xAB=|\xBA6+\r\xC2\xFD\xBCBz\xE5\xD5\x94\xBF\xD6L\x1Biv\x902=\xB5il\xAF\xBD7\x86\xB1\xC1\xC2I\x9A?\xA6#\x84G\x1BG\xAC\xC5\xA7Sr3\xDC\x80\xCF+e\xE2X\xB7\xD1\xA8\xA4N@a\xC3\xD3;\xDFO\x8D\x97n\x83\xE9&1\b\xACZd\n\xD7\xA3p=\n\xD7\xA3\xA3p=\n\xD7\xA3p=\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\xCC\0\0\0\0\0\0\0\x80\0A\xC7\xC0\0\v\xA0\0A\xD7\xC0\0\v\xC8\0A\xE7\xC0\0\v\xFA\0A\xF6\xC0\0\v@\x9C\0A\x86\xC1\0\vP\xC3\0A\x96\xC1\0\v$\xF4\0A\xA5\xC1\0\v\x80\x96\x98\0A\xB5\xC1\0\v \xBC\xBE\0A\xC5\xC1\0\v(k\xEE\0A\xD5\xC1\0\v\xF9\x95\0A\xE4\xC1\0\v@\xB7C\xBA\0A\xF4\xC1\0\v\xA5\xD4\xE8\0A\x84\xC2\0\v*\xE7\x84\x91\0A\x93\xC2\0\v\x80\xF4 \xE6\xB5\0A\xA3\xC2\0\v\xA01\xA9_\xE3\0A\xB3\xC2\0\v\xBF\xC9\x1B\x8E\0A\xC3\xC2\0\v\xC5.\xBC\xA2\xB1\0A\xD2\xC2\0\v@v:k\v\xDE\0A\xE2\xC2\0\v\xE8\x89#\xC7\x8A\0A\xF2\xC2\0\vb\xAC\xC5\xEBx\xAD\0A\x81\xC3\0\v\x07\x80z\xB7&\xD7\xD8\0A\x91\xC3\0\v\x07\x90\xACn2x\x86\x87\0A\xA1\xC3\0\v\x07\xB4W\n?h\xA9\0A\xB1\xC3\0\v\xC0(\xA1\xED\xCC\xCE\x1B\xC2\xD3\0\0\0\0\0\0\0\0\xA0\x84@aQY\x84\0\0\0\0\0\0\0\0\xC8\xA5\x90\xB9\xA5o\xA5\0\0\0\0\0\0\0\0: \xF4\'\x8F\xCB\xCE\0\0\0\0\0\0\0\0\x84	\x94\xF8x9?\x81\0\0\0\0\0\0\0@\xE5\v\xB96\xD7\x07\x8F\xA1\0\0\0\0\0\0\0P\xDENg\xCD\xC9\xF2\xC9\0\0\0\0\0\0\0\xA4\x96"\x81E@|o\xFC\0\0\0\0\0\0\0M\x9D\xB5p+\xA8\xAD\xC5\x9D\0\0\0\0\0\0 \xF0\xE3L67\xC5\0\0\0\0\0\0(l\xC6\x1B\xE0\xC3V\xDF\x84\xF6\0\0\0\0\0\x002\xC7\\l:\x96\v\x9A\0\0\0\0\0@\x7F<\xB3\x07\xC9{\xCE\x97\xC0\0\0\0\0\0\x9FK \xDBH\xBB\xC2\xBD\xF0\0\0\0\0\0\xD4\x86\xF4\x88\r\xB5P\x99v\x96\0\0\0\0\x80D1\xEBP\xE2\xA4?\xBC\0\0\0\0\xA0U\xD9\xFD%\xE5\x8EO\xEB\0\0\0\0\b\xAB\xCF]\xBE7\xCF\xD0\xB8\xD1\xEF\x92\0\0\0\0\xE5\xCA\xA1Z\xAD\'\xC6\xAB\xB7\0\0\0@\x9E=J\xF1\xC7C\xC6\xB0\xB7\x96\xE5\0\0\0\xD0\xCD\x9Cmo\\\xEA{\xCE2~\x8F\0\0\0\xA2#\0\x82\xE4\x8B\xF3\xE4\x82\xBF]\xB3\0\0\x80\x8A,\x80\xA2\xDDn0\x9E\xA1b/5\xE0\0\0 \xAD7 \v\xD5E\xDE\xA5\x9D=!\x8C\0\x004\xCC"\xF4&E\xD6\x95C\x8D)\xAF\0\0A\x7F+\xB1p\x96L{\xD4QF\xF0\xF3\xDA\0@_v\xDD\f<\xCD$\xF3+v\xD8\x88\0\xC8j\xFBi\n\x88\xA5S\0\xEE\xEF\xB6\x93\xAB\0zEz\r\xEA\x8Eh\x80\xE9\xAB\xA48\xD2\xD5\x80\xD8\xD6\x98E\x90\xA4rA\xF0q\xEBfc\xA3\x85PG\x86\x7F+\xDA\xA6GQlN\xA6@<\f\xA7$\xD9g_\xB6\x90\x90\x99e\x07\xE2\xCFPK\xCF\xD0m\xCFA\xF7\xE3\xB4\xF4\xFF\x9FD\xED\x81\x8F\x81\x82\xA4!\x89z\xF1\xF8\xBF\xC7\x95h"\xD7\xF2!\xA3\rj+R-\xF7\xAF9\xBB\xEB\x8Co\xEA\xCB\x90Dv\x9F\xA6\xF8\xF4\x9B\bj\xC3%p\v\xE5\xFE\xB4\xD5SG\xD06\xF2E"\x9A&\'O\x9F\x90e\x94,Bb\xD7\xD6\xAA\x80\x9D\xEF\xF0"\xC7\xF5~\xB9\xB7\xD2:MB\x8B\xD5\xE0\x84+\xAD\xEB\xF8\xB2\xDE\xA7e\x87\x89\xE0\xD2w\x85\f3;L\x93\x9B/\xEB\x88\x9F\xF4U\xCCc\xD5\xA6\xCF\xFFIx\xC2\xFB%k\xC7qk\xBF<\x8A\x90\xC3\x7F\'\xF3z\xEFE9NF\xEF\x8BV:\xDA\xCFq\xD8\xED\x97\xAC\xB5\xCB\xE3\xF0\x8Bu\x97\xEC\xC8\xD0C\x8EN\xE9\xBD\xA3\xBE\xED\xEER=\'\xFB\xC4\xD41\xA2c\xED\xDDK\xEEc\xA8\xAA\xA7L\xF8\xFB$_E^\x94j\xEFt>\xA9\xCA\xE8\x8F6\xE49\xEE\xB6\xD6u\xB9D+\x8ES\xFD\xE2\xB3D]\xC8\xA9dL\xD3\xE7\xB6\x96q\xA8\xBC\xDB`J:\xEA\xBE\xE4\x90\xCD1\xFEF\xE9U\x89\xBC\xDD\x88\xA4\xA4\xAE\xB5A\xBE\xBD\x98c\xAB\xABk\xAB\xCDM\x9AXd\xE2\xD1-\xED~<\x96\x96\xC6\xEC\x8A\xA0p`\xB7~\x8D\xA2<T\xCF\xE5\xFC\xA8\xAD\xC8\x8C8e\xDE\xB0\xCBK)C_\xA5%;\xD9\xFA\xAF\x86\xFE\xDD\xBE\x9E\xF3\xB7\xEFI\xAB\xC7\xFC-\xBF-\x8A7Cxl2i5n\x96\xF9{9\xD9.\xB9\xACT\x96\x07\x7F\xC3\xC2I\xFB\xF7\xDA\x87\x8Fz\xE7\xD7\xE9{\xC9^t3\xDC\xFD\xDA\xE8\xB4\x99\xAC\xF0\x86\xA3q\xED=\xBB(\xA0i\xBC#"\xC0\xD7\xAC\xA8\f\xCEh\r\xEA2\b\xC4+\xD6\xAB*\xB0\r\xD8\xD2\x90\xC3\x90\xA4?\n\xF5\xDBe\xAB\x8E\b\xC7\x83\xFA\xE0y\xDA\xC6g&yR?V\xA1\xB1\xCA\xB8\xA48Y\x91\xB8pW&\xCF\xAB	^\xFD\xE6\xCD\x86o^\xB5&L\xEDxa\v\xC6Z^\xB0\x80\xB4[1X\x81OT\xD69\x8Ew\xF1u\xDC\xA0!\xC7\xB1=\xAEaciL\xC8q\xD5m\x93\xC9\xE98\xCD:\xBC_:\xCEJIxX\xFB#\xC7e@\xA0H\xAB{\xE4\xC0\xCE-K\x9Dv\x9C?(d\r\xEBb\x9AqB\xF9]\xC4\x94\x83O2\xBD\xD0\xA5;\0e\r\x93wet\xF5yd\xE3~\xECD\x8F\xCA _\xE8\xBBj\xBFh\x99\xCBN\xCF\x8B\x99~\xE8v\xE2jE\xEF\xC2\xBF~\xA6!\xC3\xD8\xED?\x9E\xA2\x9B\xC5\xAB\xB3\xEF\xEA\xF3N\xE9\xCF\xC5\xE5\xEC\x80;\xEEJ\xD0\x95JrX\xD1\xF1\xA1\xBB(a\xCA\xA9]D\xBB\x97\xDC\x8E\xAEEn\x8A*&r\xF9<u\xEA\xBD\x932\xD7	-\xF5X\xE7\x1B\xA6,iM\x92V\x9C_p&&<Y.\xE1\xA2\xCFw\xC3\xE0\xB6l\x83w\f\xB0/\x8Boz\x99\x8B\xC3U\xF4\x98\xE4Gd\x95\x9C\xFBm\v\xEC?7\x9A\xB5\x98\xDF\x8E\xAC^\xBD\x89A\xBD$G\xE7\xC5\0\xE3~\x97\xB2W\xB6,\xEC\x91\xEC\xEDX\xE1S\xF6\xC0\x9B^=\xDF\xED\xE37g\xB6g)/l\xF4\x99X![\x86\x8Bt\xEE\x82\0\xD2\xE0y\xBD\x87q\xC0\xAE\xE9\xF1g\xAE\xAA\xA3\x80Y\xD8\xEC\xE9\x8Dpd\xEE\xDA\x95\x94\xCC Ho\xE8\xB2X\x86\x90\xFE4A\x88\xDD\xDC\x7F\x8D	1\xDE\xEE\xA74>\x82Q\xAA\xD4\x9FY\xF0FK\xBD\x96\xEA\xD1\xC1\xCD\xE2\xE5\xD4\xC9\x07p\xAC\x9El\x9E2#\x99\xC0\xAD\x85\xB0\xDD\xC6k\xCF\xE2E\xFFk\xBF0\x99S\xA6\x86\xB7F\x83\xDB\x84\xFFF\xEF|\x7F\xE8\xCFc\x9Aged\xE6n_\x8C\xAEO\xF1\x81~\xC0`?\x8F~\xCBOIw\xEF\x9A\x99\xA3m\xA2\x9D\xF083^\xBE\xE3U\xAB\x80\f	\xCB\xC5,\x07\xD3\xBF\xF5\xAD\\c*\xA0O\xCB\xFD\xF6\xF7\xC8\xC7/s\xD9s~\xDAM\xC4\x9F\x9E\xFA\x9A\xDD\xDC\xFD\xE7g(Q\xA15\xD6F\xC6\xB8T\xFD\xE1\x81\xB2e\xA5	B\xC2\x8B\xD8\xF7&B\xA9|Z"_\x07FiYW\xE7\x9AXi\xB0\xE9\x8Dxu37\x89\x97\xC3/-\xA1\xC1\xAE\x83d\xB1\xD6R\0\x84k}\xB4{x	\xF2\x9A\xA4#\xBD]\x8Cg\xC02c\xCEPM\xEBE\x97\xE0F6\x96\xBA\xB7@\xF8\xFF\xFB\xA5 f\xBD\x98\xD8\xC3;\xA9\xE5P\xB6\xFFzB\xCE\xA8?]\xEC\xBE\xCE\xB4\x8A\xE5\xA3\xDF\x8C\xE9\x80\xC9G\xBA\x937\xB16l3o\xC6\xF0#\xE1\xBB\xD9\xA8\xB8\x84A]DG\0\v\xB8\xECl\xD9*\xD3\xE6\xE5\x91tY\xC0\r\xA6\x92\xE4\xC7\xEAC\x90/\xDBh\xAD7\x98\xC8\x87w\xDDy\xA1\xE4T\xB4\xFB\xC3\x98E\xBE\xBA)\x94^T\xD8\xC9j\xE1z\xD6\xF3\xFE\xD6m)\xF4\xBB4\'\x9ER\xE2\x8C\ffX_\xA6\xE4\x99\xE4\xE9\xB1E\xE7\xB0\x8F\x7F.\xF7\xCF]\xC0^]dB\xA1!\xDCs\xFA\xF4Cupv\xBA~Ir\xAE\x95\x89\xA8SyJIji\xDE\xDB\xDAE\xFA\xAB\x92hc\x9D\xDB\x87\xD6\x92\x92P\xD7\xF8\xD6\xB6B<]\x84\xD2\xA9E\xC2\xC5\x9B[\x92\x86[\x86\xB2\xA9E\xBA\x92#\x8A\v2\xB7\x82\xF26h\xF2\xA7\xD7hw\xACl\x8E\xFFd#\xAFD\xEF\xD1&\xD9\fC\x95\xD7\x072v\xEDja5\x83\xB8\x07\xE8I\xBD\xE6D\x7F\xE7\xA6\xD3\xA8\xC5\xB9\xA4\xA6	b\x9Cl _\xA1\x90\b7h\xCD\x8Cz\xC3\x87\xA8\xDB6dZ\xE5k"!"\x80\x89\x97,\xDATII\xC2\xFD\xB0\xDEk\xA9*\xA0l\xBD\xB7\xAA\x9B\xDB\xF2=]\x96\xC8\xC5S5\xC8\xC7\xAC\xE5\x94\x94\x82\x92o\x8C\xF4\xBB:\xB7\xA8B\xFA\xF9\xBA9#w\xCB\xD7x\xB5\x84r\xA9i\x9C\xFBnSv*\xFF\r\xD7\xE2%\xCF\x84\xC3\xBAJh\x85\xF5\xFE\xD1\x8C[\xEF\xC2e\xF4i]\xC2_fX\xB2~8\x99\xD5y/\xBF\x98az\xD9\xFB?w/\xEF\x86\xFFJX\xFB\xEE\xBE\xFA\xD8\xCF\xFAU\xFB\xAA\x84g\xBF].\xBA\xAA\xEE8\xCF\x83\xF9S*\xBA\x95\xB2\xA0\x97\xFA\\\xB4*\x95\x83a\xF2{tZ\x94\xDD\xDF\x88=9tau\xBA\xE4\xF9\xEE\x9Aq\xF9\x94\xEB\x8CG\xD1\xB9\xE9]\xB8\xAAV\xCD7z\xEE\xB8\xCC"\xB4\xAB\x91:\xB3\n\xC1U\xE0b\xAC\xAA\xE6\x7F+\xA1\xB6	`M1k\x98{W\x94\x9D\xDF_vI\x9C\xE3\v\xB8\xA0\xFD\x85~Z\xED}\xC2\xEB\xFB\xE9\xADA\x8E\x07s\x84\xBE\x8FX\xB3\xE6zd\xD2\xB1\xC8\x8F%\xAE\xD8\xB2nY\xE3_\xA0\x99\xBD\x9FF\xDE\xBB\xF3\xAE\xD9\x8E_\xCAo\xEE;\x80\xD6#\xEC\x8ATX\rH\xB9{\xDE%\xE9J \xCC,\xA7\xADj\xAE\x9A\xA7V\xAF\xA4\x9D(\xFF\xF7\xD9\xDA\x94\x80Q\xA1+\x1B\x86"y\xFF\x9A\xAA\x87B\b]\xF0\xD2D\xFB\x90(+EW\xBFA\x95\xA9SJt\xAC\x07:5\xF2u-/\x92\xFA\xD3\xE8\\\x91\x97\x89\x9B\x88B\xB7	.|]\x9B|\x84\xDA\xBA\xFE5a\x95i%\x8C9\xDB4\xC2\x9B\xA5\x95\x90i~\x83\xB9\xFAC.\xEF\x07\xC2\xB2\xCF\xBB\xF4^\xE4g\xF9\x94}\xF5DK\xB9\xAFa\x81\xF5x\xC2\xBA\xEE\xE0\x1B\xDC2\x9E\xA7\x1B\xBA\xA12si*\xD9bd\x93\xBF\x9B\x85\x91\xA2(\xCA\xFE\xDC\xCFu\x8F{}x\xAF\xE75\xCB\xB2\xFC>\xD4\xC3DRs\xDA\\\xAB\xADa\xB0\xBF\xEF\x9D\xA7d\xFAj\x88\b:z\xC2\xAEk\xC5\xD0\xFD\xB8E\xAA\x8A\b[\x9F\x98\xA3r\x9A\xC6\xF6E=\'W\x9ET\xAD\x8A\x99c?\xA6\x87 <\x9AK\x86x\xF6\xE2T\xAC6\x7F<\xCF\x8F\xA9(\xCB\xC0\xDD\xA7\xB4\x1BjW\x84\x9F\v\xC3\xF3\xD3\xF2\xFD\xF0\xD5Q\xA1\xA2DmeC\xE7Yx\xC4\xB7\x9E\x96%\xB3\xB1\xA4\xE5Jd\x9Fap\x96\xB5eF\xBC\xEE\xDE\r\x9F]=\x87Yy\f\xFC"\xFFW\xEB\xEA\xA7U\xD1\xB5\f\xA9\xD8\xCB\x87\xDDu\xFF\x93\xF2\x88\xD5B$\xF1\xA7	\xCE\xBE\xE9TS\xBF\xDC\xB7/\xEB\x8ASm\xED\f\x81.$*(\xEF\xD3\xE5\xFA\xA5m\xA8\xC8h\x8F\x9DVyu\xA4\x8F\xBC\x87Di}n\xF9UD\xEC`\xD7\x92\x8D\xB3\xAC\xA9\x95\xC3\xDC\x81\xC97jU\'9\x8D\xF7p\xE0{\xF4S\xE2\xBB\x85b\x95\xB8C\xB8\x9AF\x8C\x8E\xEC\xCCxtm\x95\x93\xBB\xBA\xA6TfAX\xAF\xB2\'\0\x97\xD1\xC8z8ji\xD0\xE9\xBFQ.\xDB\x9E1\xC0\xFC{\x99\xE2A"\xF2\xF3\xFC\x88\xF8\xBD\xE3\xECDZ\xD2\xAA\xEE\xDD/<\xAB\xC3&v\xAD\xE8\'\xD5\xF1\x86Uj\xD5;\v\xD6t\xB0\xD3\xD8#\xE2q\x8AVtube\xC7\x85IN\x84gV-\x87\xF6l\xD1\xBB\xBE\xC68\xA7\xDBae\xAC\xF8(\xB4\xC7\x85\xD7in\xF8\xD1R\xBA\xBE\xD763\xE1\x9C\xB3&E[\xA4\x82s4aF\xC0\xEC\x84`\xB0BrM\xA3\x90]\xF9\xD7\xF0\'\xA5x\\\xD3\x9B\xCE \xCC\xF4A\xB4\xF7\x8D\xEC1\xCE\x963\xC8B)\xFFqR\xA1uqg~A> \xBDi\xA1y\x9F\x86\xD3\x84\xE9\xC6b\0\xD1Mh,\xC4	X\xC7h\b\xE6\xA3x{\xC0REa\x8275\f.\xF9\x82\x8A\xDF\xCCV\x9Ap\xA7\xCB|\xB1B\xA1\xC7\xBC\x9B\x91\xB6\v@v`\xA6\x88\xFE\xDB]\x93\x89\xF9\xAB\xC25\xA4\xD0\x93\xF8\xCFj\xFER5\xF8\xEB\xF7V\xF3CM\xC4\xB8\xF6\x83\xDES!{\xF3Z\x98Jp\x8Bz3zr\xC3\xD6\xA8\xE9Y\xB0\xF1\x1B\xBE\\L.Y\xC0Ot\fdp\xEE\xA2\xEDs\xDFyo\xF0\xDEb\xE7\x8B>\xC6\xD1\xD4\x85\x94\xA8+\xACEV\xCB\xDD\x8A\xE1.\xCE7J\xA7\xB9\x926\xD7+>\x95m\x99\xBA\xC1\xC5\x87\xE87\xDD\xCC\xB6\x8D\xFA\xC8\xA0\x99\xDB\xD4\xB1\n\x91\xA2"\n@\x92\x98\x9C\xC8Y\x7FJ^M\xB5K\xAB\f\xD0\xB6\xBE%:0\x97\xDC\xB5\xA0\xE2\xD6\x84d\xAED.$~s\xDE\xA9q\xA4\x8D\xD2\xE5\x89\xD2\xFE\xEC\xEA\\\xAD]V\x8E\r\xB1G_,\x87>\xA8%tu\x94k\x99\xF1P\xDDw\xF7(N/\xD1/\xC9<\xE3\xFF\x96R\x8Ao\xAA\x9A\xD9pk\xBD\x82{\xFB\v\xDC\xBF<\xE7\xAC\vUM\xC6lcZ\xFA\xD3\xEF\v!\xD8N\xAAT\xE0\xF7G<x\\\xE9\xE3u\xA7\x87q\n\x814\xEC\xFA\xACe\x96\xB3\xE3\\S\xD1\xD9\xA8\rM\xA1A\xA79\x7F|\xA04\xA8E\xD3P\xA0	H\xDEM\xE4\x91 \x89+\xEA\x832F\xAB\n\xEDJ\x93`]\xB6hk\xB6\xE4\xA4?\x85VM\xA8\xF8\xB9\xF4\xE3B\xE4\xCE\x8Ef\x9D\xAB`%6\xF3x\xCE\xE9\x83\xAE\xD2\x80`Bk|+\xD7\xC10B\xE4$Z\x07\xA1\xF8\x86[\xF6L\xB2\xFC\x9CR\xAE0I\xC9\'\xB6\x97g\xF23\xE0\xDE<D\xA7\xA4\xD9|\x9B\xFB\xB1\xA3}\xEF@\x98\xA5\x8A\xE8\b.A\x9DN\x86\xEE`\x95(\x8EN\xAD\xA2\b\x8Ay\x91\xC4\xE2\'*\xB9\xBA\xF2\xA6\xF1\xA2X\xCB\x8A\xEC\xD7\xB5\xF5\xDB\xB1tgi\xAF\xAEe\xBF\xD6\xF3\xA6\x91\x99)\xEF\xA8\xE0\xA1m\xCA\xAC?\xDDn\xCC\xB0\xF6\xBF\xF3*\xD3X\n	\xFD\x8E\x94\x8A\xFF\xDC\x94\xF3\xEF\xB0\xF5\x07\xEFLK\xFC\xDD\xD9\x9C\xB6\n=\xF8\x95\x8E\xF9d\xAF\xBDJD\xA4\xA7LLv\xBB\xF17\xBE\xD4m\x9DU\x8D\xD1_\xDFS\xEA\xED\xC5m!\x89a\xC8\x84,U\xF8\xE2\x9Bkt\x92\xB4\x9B\xE4\xB4\xF5<\xFD2wj\xB6\xDB\x82\x86\xB7\xA1\xC2"3\x8C\xBC?\xA4\x92#\xE8\xD5\xE4J3\xA5\xEA?\xAF\xAB-\x83\xA6;\xB1\x8F@\xA7\xF2\x87M\xCB)\xF8#\x90\xCA[\xC7\xB2Q\xEF\xE9 >t\xF6,4\xBD\xB2\xE4x\xDFT%k$\xA9M\x91\x9C@\xB6\xEF\x8E\xAB\x8B\x8ET\xF7\xC2\xB6\x89\xD0 \xC3\xD0\xA3\xABr\x96\xAE\xB1)\xB5s$\xAC\x84\xA1\xE8\xF3\xC4\x8CV<\xDAt\xA2\x90-\xD7\xE5\xC9q\xFB\x96\x89e\x88\x92\x88ez|\xA6/~\x8D\xDE\xF9\x9D\xFB\xEB~\xAA\xB7\xEA\xFE\x98\x1B\x90\xBB\xDD1Vx\x85\xFA\xA6\xD5e\xA5>\x7F"t*U\xDE5k\x93\\(3\x85_\'\x87\x8F\x95\x88:\xD5VF\xB8s\xF2\x7F\xA67\xF1h\xF3\xBA*\x89\x8A,\x84W\xA6\xEF\xD0\x85-C\xB0iu+-\x9B\xB2\xF6gj\xF5\x82s\xFC)b);\x9CB_\xF4\xC5\xF2\x98\xA2\x8F{\xB4\x91\xBA\xF3I\x83wqBv/?\xCBs\x9A!6\xA9p$\xD7\xD4\r\xD3S\xFB\xFE\xAA\x83\xD3\x8C#\xED\xA5\xE8c]\xC9\x9E\xAA@J286\xF4H\xCE\xE2|Y\xB4{\xC6\xD5\xD0\xDC>\xC6C\xB1\xDA\x81\x1B\xDCo\xA1\xF8\n\x94\x8E\x86\xB7\x94\xDD(1\x91\xE9\xE5\xA4\x9B&\x83\xB4\xF2|\xCAr}\xF5c\xCE\xD4\xC1\xF0\xA3ca/\xFD\xCF\xDC\xF2<\xA7J\xF2\xEC\x8C<g9;c\xBC\xCA\x86\bAn\x97\xD8\x85\xE0\xBE\xD5\x82\xBC\x9D\xA7J\xD1I\xBDN\xA7\xD8D\x86-K\xA2+\x85Q\x9DE\x9C\xEC\x9E!\xD1\xD6\xE7\xF8\xDDE;\xF3R\x82\xAB\xE1\x93\xB5B\xC9\xE5\x90\xBB\xCA\n\xB0\xE7b\xDA\xB8Cb\x93;uj=\x9D\f\x9C\xA1\xFB\x9B\xE7\xD4:x\ng\xC5\f\xE2\x87E}aj\x90\xC5$\x8Bf\x80+\xFB\'\xDA\xE9A\x96\xDC\xF9\x84\xB4\xF6\xED-\x80`\xF6\xF9\xB1Qd\xD2\xBBS8\xA6\xE1si9\xA0\xF8sx^\xB2~cU4\xE3\x07\x8D\xE8\xE1#d{H\v\xDB_^\xBCj\xDCI\xB0b\xDA,=\x9A\xCE\x91\xF7uk\xC5S\\\xDC\xFBx\xCC@\xA1Av\xBA)c\x1B\xE1\xB3\xB9\x89\x9D\n\xCB\x7F\xC8\xE9\xA9)\xF4;b\xD9 (\xACD\xCD\xBD\x9F\xFAEcT3\xF1\xCA\xBA)2\xD7\x95@\xADGy|\xA9\xC0\xD6\xBE\xD4\xA9Y\x7F\x86]H\xCC\xCC\xAB\x8E\xEDIp\x8C\xEEI0\xA8tZ\xFF\xBFV\xF2h\\\x8C/j\\\xFC&\xD21\xFFo\xEC.\x83s\xB7]\xC2\xD9\x8F]X\x83\xAB~\xFF\xC5S\xFD1\xC8%\xF52\xD0\xF3t.\xA4U^\x7F\xB7\xA8|>\xBAo\xB2?\xC40:\xCD\xEB5_\xE5\xD2\x1B\xCE(\x85\xCF\xA7z^KD\x80\xB3\x81[\xCFc\xD1\x80yf\xC3Q6^U\xA0b2\xC3\xBC\xE1\xD7@4\xA6\x9F\xC3\xB5j\xC8\xA7\xFA\xFE\xF3+G\xD9\x8DP\xC1\x8F\x874c\x85\xFAQ\xB9\xFE\xF0\xF6\x98O\xB1\xD2\xD8\xB9\xD4\0^\x93\x9C\xD33\x9FV\x9A\xBF\xD1n\x07O\xE8	\x815\xB8\xC3\xC8\0G\xEC\x80/\x86\n\xC8bbL\xE1B\xA6\xF4\xFA\xC0X\'a\xBB\'\xCD\xBD}\xBD\xCF\xCC\xE9\xE7\x98\x9Cx\x97\xB8\xD58\x80,\xDD\xAC@\xE4!\xBF\xC3V\xBD\xE6c\nG\xE0x\x98P]\xEA\xEEt\xACl\xE0\xFC\xCCX\xCB\f\xDFRzR\x95\xC8\xEBC\f\x807\xFD\xCF\x96\x83\xE6\xA7\xBA\xBA\xE6T\x8F%`\xD3\xFD\x83|$ \xDFP\xE9i *\xF3.\xB8\xC6G~\xD2\xCDt\x8B\xD2\x91AT\xFAW3\xDCLG\x81Q.G\xB6R\xE9\xF8\xAD\xE4?\xE0\xE5\x98\xA1c\xE5\xF9\xD8\xE3\xA6#w\xD9\xDDX\x8F\xFFD^/\x9Cg\x8EHv\xEA\xA7\xEA	Ws?\xD65;\x83\xB2\xDA\xE5Qe\xCC\xD2,O\xCFK\n\xE4\x81\xDE\xD1X^\xA6~\x7F\x07\xF8\x91aB\x86.\x8B\x82\xF7\xFA\'\xAF\xAF\xFB\xF69\x93\xD2\'z\xD5\xADc\xB5\xF9\xF1\x9A\xDB\xC5yt\b8\xC7\xB1\xD8J\xD9\xBC"x\xAE\x81R7H\x83o\xC7\xCE\x87\xB5\v\r\x91\x93"\x8F\x9A\xC6\xA3\xE3Jy\xC2\xA9"\xDBMPu8\xEB\xB2A\xB8\x8C\x9C\x9D3\xD4\xEBQa\xA4\x92\xA6_(\xF3\xD7\x81\xC2\xEE\x9F\x843\xD3\xBC\xA6\x1B\xC4\xC7\xDB\xF3\xEFM"s\xEA\xC7\xA5\0\bl\x90"\xB5\xB9\xEFk\xE1\xEA\xE59\xCF\0\n\x874k"h\xD7u\xE3\xCC\xF2)/\x84\x81@f\xD4\0\x83\xA1\xE6S\x80o\xF4:\xE5\xA1\xD0\x7F	\xC1\xE3ZI`h#`\x8B\xB1\x89^\xCA\xC4\xDFK\xB1\x9C\xB1[8B,8\xEE,\xF6\xFC\xB5\xD7\x9E\xDD\x9ErF\xA9\x1B\xE3\xB4\x92\xDB\x9E\xD1F\x83j\xC2\xA2\x07l\0\0\0\0\0\0\0\n\0\0\0\0\0\0\0d\0\0\0\0\0\0\0\xE8\0\0\0\0\0\0\'\0\0\0\0\0\0\xA0\x86\0\0\0\0\0@B\0\0\0\0\0\x80\x96\x98\0\0\0\0\0\0\xE1\xF5\0\0\0\0\0\xCA\x9A;\0\0\0\0\0\xE4\vT\0\0\0\0\xE8vH\0\0\0\0\xA5\xD4\xE8\0\0\0\0\xA0rN	\0\0\0@z\xF3Z\0\0\0\x80\xC6\xA4~\x8D\0\0\0\xC1o\xF2\x86#\0\0\0\x8A]xEc\0\0d\xA7\xB3\xB6\xE0\r\0\0\xE8\x89#\xC7\x8A00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899\0\0\0\0\0\0\0\0\0A\xFA\xEB\0\v\0A\x84\xEC\0\v\0A\x8E\xEC\0\v\0A\x98\xEC\0\v\0A\xA2\xEC\0\v\0A\xAC\xEC\0\v\0A\xB6\xEC\0\v\0A\xC0\xEC\0\v\0A\xCA\xEC\0\v\0A\xE0\xEC\0\v\0A\xF8\xEC\0\v\xEB\n\0\0\0\0\0\0\0\xCD\xCC\xCC\xCC\xCC\xCC\xCC\xCC\0\0\0\0\0\0\0d\0\0\0\0\0\0\0\xC3\xF5(\\\x8F\xC2\xF5(\0\0\0\0\0\0\xE8\0\0\0\0\0\0\xCF\xF7S\xE3\xA5\x9B\xC4 \0\0\0\0\0\0\'\0\0\0\0\0\0KY\x868\xD6\xC5m4\0\0\0\0\v\0\0\0\xA0\x86\0\0\0\0\0Cx\xB4q\xC4Z|\n\0\0\0\x07\0\0\0@B\0\0\0\0\0\xDB4\xB6\xD7\x82\xDE\x1BC\0\0\0\0\0\0\0\x80\x96\x98\0\0\0\0\0\xBDBz\xE5\xD5\x94\xBF\xD6\0\0\0\0\0\0\0\0\xE1\xF5\0\0\0\0\xFD\xCEa\x84w\xCC\xAB\0\0\0\0\0\0\0\0\xCA\x9A;\0\0\0\0SZ\x9B\xA0/\xB8D\0	\0\0\0\v\0\0\0\0\xE4\vT\0\0\0\xBF\xD5\xED\xBD\xCE\xFE\xE6\xDB\0\0\0\0!\0\0\0\0\xE8vH\0\0\0\xFF\xAA$\xCB\v\xFF\xEB\xAF\0\0\0\0$\0\0\0\0\xA5\xD4\xE8\0\0\x003"\xD4[3/#\0\0\0\0%\0\0\0\0\xA0rN	\0\0\x85\xED\x92\xD0\x84K8\0\0\0\0)\0\0\0\0@z\xF3Z\0\0\x81\xCD\x95P\xC3MB\v\0\0\0\0*\0\0\0\0\x80\xC6\xA4~\x8D\0\xC3\xEA\xDC\xF3u@\0\0\0\0\0\0\0\0\0\xC1o\xF2\x86#\0Wx\xB1/e\xA59\0\0\0\x003\0\0\0\0\0\x8A]xEcS\x1B\xD5;\\\0\0\0\0\0\0\0\0\0\0d\xA7\xB3\xB6\xE0\rIGw\xC9I\0\0\0\0\0\0\0\0\0\0\xE8\x89#\xC7\x8A\xD3\xB0J\xDB>%v\0\0\0\0>\0\0\0\0\0\0A\x9C\xF1\0\v\0A\xC0\xF1\0\v\xBD	\b\b\b\b\b\b\b\b000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F404142434445464748494A4B4C4D4E4F505152535455565758595A5B5C5D5E5F606162636465666768696A6B6C6D6E6F707172737475767778797A7B7C7D7E7F808182838485868788898A8B8C8D8E8F909192939495969798999A9B9C9D9E9FA0A1A2A3A4A5A6A7A8A9AAABACADAEAFB0B1B2B3B4B5B6B7B8B9BABBBCBDBEBFC0C1C2C3C4C5C6C7C8C9CACBCCCDCECFD0D1D2D3D4D5D6D7D8D9DADBDCDDDEDFE0E1E2E3E4E5E6E7E8E9EAEBECEDEEEFF0F1F2F3F4F5F6F7F8F9FAFBFCFDFEFF                \\b\\t\\n  \\f\\r                                        \\"                        \\/                                                                                        \\\\                                                                                                                                                                                                                                                                                                                                      \0\0\0\0\x07\0\0\0\x07\0\0\0\b\0\0\0\b\0\0\0\b\0\0\0\b\0\0\0\b\0\0\0\b\0\0\0\x07\0\0\0\x07\0\0\0\b\0\0\0\x07\0\0\0\x07\0\0\0\x07\0\0\0\x07\0A\xA0\xFB\0\v\b\0\0\0\b\0\0\0\x07\0\0\0\x07\0\0\0\0\0\0\0\x07\0\0\0\0\0\0\0\b\0A\xD0\xFC\0\vA\0\v\0\0\0\0\0\0\0\0\0\0\0	\0\0\0\0\v\0\0\0\0\0\0\0\0\0\n\n\n\x07\0\0	\v\0\0	\v\0\0\v\0\0\0\0\0A\xA1\xFD\0\v!\0\0\0\0\0\0\0\0\0\v\r\0\r\0\0\0	\0\0\0	\0\0\0\0A\xDB\xFD\0\v\f\0A\xE7\xFD\0\v\0\0\0\0\0\0\0\0	\f\0\0\0\0\0\f\0\0\f\0A\x95\xFE\0\v\0A\xA1\xFE\0\v\0\0\0\0\0\0\0	\0\0\0\0\0\0\0\0A\xCF\xFE\0\v\0A\xDB\xFE\0\v\0\0\0\0\0\0\0\0	\0\0\0\0\0\0\0\0\0\0\0\0\0A\x92\xFF\0\v\0\0\0\0\0\0\0\0\0	\0A\xC3\xFF\0\v\0A\xCF\xFF\0\v\0\0\0\0\0\0\0\0	\0\0\0\0\0\0\0\0A\xFD\xFF\0\v\0A\x89\x80\v\'\0\0\0\0\0\0\0\0	\0\0\0\0\0\0\0\0\x000123456789ABCDEF\0A\xB0\x80\v\x90B');
    }
    function getBinarySync(file) {
      return file;
    }
    async function getWasmBinary(binaryFile) {
      return getBinarySync(binaryFile);
    }
    async function instantiateArrayBuffer(binaryFile, imports) {
      try {
        var binary = await getWasmBinary(binaryFile);
        var instance = await WebAssembly.instantiate(binary, imports);
        return instance;
      } catch (reason) {
        err(`failed to asynchronously prepare wasm: ${reason}`);
        abort(reason);
      }
    }
    async function instantiateAsync(binary, binaryFile, imports) {
      return instantiateArrayBuffer(binaryFile, imports);
    }
    function getWasmImports() {
      var imports = { a: wasmImports };
      return imports;
    }
    async function createWasm() {
      function receiveInstance(instance) {
        wasmExports = instance.exports;
        assignWasmExports(wasmExports);
        updateMemoryViews();
        return wasmExports;
      }
      function receiveInstantiationResult(result2) {
        return receiveInstance(result2["instance"]);
      }
      var info = getWasmImports();
      var instantiateWasm = Module["instantiateWasm"];
      if (instantiateWasm) {
        return new Promise((resolve) => {
          instantiateWasm(info, (inst) => resolve(receiveInstance(inst)));
        });
      }
      wasmBinaryFile ??= findWasmBinary();
      var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
      var exports = receiveInstantiationResult(result);
      return exports;
    }
    class ExitStatus {
      name = "ExitStatus";
      constructor(status) {
        this.message = `Program terminated with exit(${status})`;
        this.status = status;
      }
    }
    var HEAP8;
    var stackRestore = (val) => __emscripten_stack_restore(val);
    var stackSave = () => _emscripten_stack_get_current();
    var __abort_js = () => abort("");
    var runtimeKeepaliveCounter = 0;
    var __emscripten_runtime_keepalive_clear = () => {
      runtimeKeepaliveCounter = 0;
    };
    var timers = {};
    var handleException = (e) => {
      if (e instanceof ExitStatus || e == "unwind") {
        return EXITSTATUS;
      }
      quit_(1, e);
    };
    var keepRuntimeAlive = () => true;
    var _proc_exit = (code) => {
      EXITSTATUS = code;
      if (!keepRuntimeAlive()) {
        ABORT = true;
      }
      quit_(code, new ExitStatus(code));
    };
    var exitJS = (status, implicit) => {
      EXITSTATUS = status;
      _proc_exit(status);
    };
    var _exit = exitJS;
    var maybeExit = () => {
      if (!keepRuntimeAlive()) {
        try {
          _exit(EXITSTATUS);
        } catch (e) {
          handleException(e);
        }
      }
    };
    var callUserCallback = (func) => {
      if (ABORT) {
        return;
      }
      try {
        return func();
      } catch (e) {
        handleException(e);
      } finally {
        maybeExit();
      }
    };
    var _emscripten_get_now = () => performance.now();
    var __setitimer_js = (which, timeout_ms) => {
      if (timers[which]) {
        clearTimeout(timers[which].id);
        delete timers[which];
      }
      if (!timeout_ms) return 0;
      var id = setTimeout(() => {
        delete timers[which];
        callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
      }, timeout_ms);
      timers[which] = { id, timeout_ms };
      return 0;
    };
    var getHeapMax = () => 2147483648;
    var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
    var growMemory = (size) => {
      var oldHeapSize = wasmMemory.buffer.byteLength;
      var pages = (size - oldHeapSize + 65535) / 65536 | 0;
      try {
        wasmMemory.grow(pages);
        updateMemoryViews();
        return 1;
      } catch (e) {
      }
    };
    var HEAPU8;
    var _emscripten_resize_heap = (requestedSize) => {
      var oldSize = HEAPU8.length;
      requestedSize >>>= 0;
      var maxHeapSize = getHeapMax();
      if (requestedSize > maxHeapSize) {
        return false;
      }
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
        var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
        var replacement = growMemory(newSize);
        if (replacement) {
          return true;
        }
      }
      return false;
    };
    var getCFunc = (ident) => {
      var func = Module["_" + ident];
      return func;
    };
    var writeArrayToMemory = (array, buffer) => {
      HEAP8.set(array, buffer);
    };
    var lengthBytesUTF8 = (str) => {
      var len = 0;
      for (var i = 0; i < str.length; ++i) {
        var c = str.charCodeAt(i);
        if (c <= 127) {
          len++;
        } else if (c <= 2047) {
          len += 2;
        } else if (c >= 55296 && c <= 57343) {
          len += 4;
          ++i;
        } else {
          len += 3;
        }
      }
      return len;
    };
    var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
      if (!(maxBytesToWrite > 0)) return 0;
      var startIdx = outIdx;
      var endIdx = outIdx + maxBytesToWrite - 1;
      for (var i = 0; i < str.length; ++i) {
        var u = str.codePointAt(i);
        if (u <= 127) {
          if (outIdx >= endIdx) break;
          heap[outIdx++] = u;
        } else if (u <= 2047) {
          if (outIdx + 1 >= endIdx) break;
          heap[outIdx++] = 192 | u >> 6;
          heap[outIdx++] = 128 | u & 63;
        } else if (u <= 65535) {
          if (outIdx + 2 >= endIdx) break;
          heap[outIdx++] = 224 | u >> 12;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        } else {
          if (outIdx + 3 >= endIdx) break;
          heap[outIdx++] = 240 | u >> 18;
          heap[outIdx++] = 128 | u >> 12 & 63;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
          i++;
        }
      }
      heap[outIdx] = 0;
      return outIdx - startIdx;
    };
    var stringToUTF8 = (str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
    var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
    var stringToUTF8OnStack = (str) => {
      var size = lengthBytesUTF8(str) + 1;
      var ret = stackAlloc(size);
      stringToUTF8(str, ret, size);
      return ret;
    };
    var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();
    var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
      var maxIdx = idx + maxBytesToRead;
      if (ignoreNul) return maxIdx;
      while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
      return idx;
    };
    var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
      var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
      if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
        return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
      }
      var str = "";
      while (idx < endPtr) {
        var u0 = heapOrArray[idx++];
        if (!(u0 & 128)) {
          str += String.fromCharCode(u0);
          continue;
        }
        var u1 = heapOrArray[idx++] & 63;
        if ((u0 & 224) == 192) {
          str += String.fromCharCode((u0 & 31) << 6 | u1);
          continue;
        }
        var u2 = heapOrArray[idx++] & 63;
        if ((u0 & 240) == 224) {
          u0 = (u0 & 15) << 12 | u1 << 6 | u2;
        } else {
          u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
        }
        if (u0 < 65536) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 65536;
          str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
        }
      }
      return str;
    };
    var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "";
    var ccall = (ident, returnType, argTypes, args, opts) => {
      var toC = { string: (str) => {
        var ret2 = 0;
        if (str !== null && str !== void 0 && str !== 0) {
          ret2 = stringToUTF8OnStack(str);
        }
        return ret2;
      }, array: (arr) => {
        var ret2 = stackAlloc(arr.length);
        writeArrayToMemory(arr, ret2);
        return ret2;
      } };
      function convertReturnValue(ret2) {
        if (returnType === "string") {
          return UTF8ToString(ret2);
        }
        if (returnType === "boolean") return Boolean(ret2);
        return ret2;
      }
      var func = getCFunc(ident);
      var cArgs = [];
      var stack = 0;
      if (args) {
        for (var i = 0; i < args.length; i++) {
          var converter = toC[argTypes[i]];
          if (converter) {
            if (stack === 0) stack = stackSave();
            cArgs[i] = converter(args[i]);
          } else {
            cArgs[i] = args[i];
          }
        }
      }
      var ret = func(...cArgs);
      function onDone(ret2) {
        if (stack !== 0) stackRestore(stack);
        return convertReturnValue(ret2);
      }
      ret = onDone(ret);
      return ret;
    };
    var cwrap = (ident, returnType, argTypes, opts) => {
      var numericArgs = !argTypes || argTypes.every((type) => type === "number" || type === "boolean");
      var numericRet = returnType !== "string";
      if (numericRet && numericArgs && !opts) {
        return getCFunc(ident);
      }
      return (...args) => ccall(ident, returnType, argTypes, args, opts);
    };
    var wasmTableMirror = [];
    var getWasmTableEntry = (funcPtr) => {
      var func = wasmTableMirror[funcPtr];
      if (!func) {
        wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
      }
      return func;
    };
    var updateTableMap = (offset, count) => {
      if (functionsInTableMap) {
        for (var i = offset; i < offset + count; i++) {
          var item = getWasmTableEntry(i);
          if (item) {
            functionsInTableMap.set(item, i);
          }
        }
      }
    };
    var functionsInTableMap;
    var getFunctionAddress = (func) => {
      if (!functionsInTableMap) {
        functionsInTableMap = /* @__PURE__ */ new WeakMap();
        updateTableMap(0, wasmTable.length);
      }
      return functionsInTableMap.get(func) || 0;
    };
    var freeTableIndexes = [];
    var getEmptyTableSlot = () => {
      if (freeTableIndexes.length) {
        return freeTableIndexes.pop();
      }
      return wasmTable["grow"](1);
    };
    var setWasmTableEntry = (idx, func) => {
      wasmTable.set(idx, func);
      wasmTableMirror[idx] = wasmTable.get(idx);
    };
    var uleb128EncodeWithLen = (arr) => {
      const n = arr.length;
      return [n % 128 | 128, n >> 7, ...arr];
    };
    var wasmTypeCodes = { i: 127, p: 127, j: 126, f: 125, d: 124, e: 111 };
    var generateTypePack = (types) => uleb128EncodeWithLen(Array.from(types, (type) => {
      var code = wasmTypeCodes[type];
      return code;
    }));
    var convertJsFunctionToWasm = (func, sig) => {
      var bytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, ...uleb128EncodeWithLen([1, 96, ...generateTypePack(sig.slice(1)), ...generateTypePack(sig[0] === "v" ? "" : sig[0])]), 2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
      var module = new WebAssembly.Module(bytes);
      var instance = new WebAssembly.Instance(module, { e: { f: func } });
      var wrappedFunc = instance.exports["f"];
      return wrappedFunc;
    };
    var addFunction = (func, sig) => {
      var rtn = getFunctionAddress(func);
      if (rtn) {
        return rtn;
      }
      var ret = getEmptyTableSlot();
      try {
        setWasmTableEntry(ret, func);
      } catch (err2) {
        if (!(err2 instanceof TypeError)) {
          throw err2;
        }
        var wrapped = convertJsFunctionToWasm(func, sig);
        setWasmTableEntry(ret, wrapped);
      }
      functionsInTableMap.set(func, ret);
      return ret;
    };
    var removeFunction = (index) => {
      functionsInTableMap.delete(getWasmTableEntry(index));
      setWasmTableEntry(index, null);
      freeTableIndexes.push(index);
    };
    {
      if (Module["print"]) out = Module["print"];
      if (Module["printErr"]) err = Module["printErr"];
      if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
    }
    Module["ccall"] = ccall;
    Module["cwrap"] = cwrap;
    Module["addFunction"] = addFunction;
    Module["removeFunction"] = removeFunction;
    Module["UTF8ToString"] = UTF8ToString;
    Module["stringToUTF8"] = stringToUTF8;
    Module["lengthBytesUTF8"] = lengthBytesUTF8;
    var _syncer_merge_flat_cb, _syncer_merge_flat, _syncer_wasm_alloc_bytes, _syncer_free, _free, _syncer_version, _malloc, __emscripten_timeout, __emscripten_stack_restore, __emscripten_stack_alloc, _emscripten_stack_get_current, memory, __indirect_function_table, wasmMemory, wasmTable;
    function assignWasmExports(wasmExports2) {
      _syncer_merge_flat_cb = Module["_syncer_merge_flat_cb"] = wasmExports2["h"];
      _syncer_merge_flat = Module["_syncer_merge_flat"] = wasmExports2["i"];
      _syncer_wasm_alloc_bytes = Module["_syncer_wasm_alloc_bytes"] = wasmExports2["j"];
      _syncer_free = Module["_syncer_free"] = wasmExports2["k"];
      _free = Module["_free"] = wasmExports2["l"];
      _syncer_version = Module["_syncer_version"] = wasmExports2["m"];
      _malloc = Module["_malloc"] = wasmExports2["n"];
      __emscripten_timeout = wasmExports2["p"];
      __emscripten_stack_restore = wasmExports2["q"];
      __emscripten_stack_alloc = wasmExports2["r"];
      _emscripten_stack_get_current = wasmExports2["s"];
      memory = wasmMemory = wasmExports2["f"];
      __indirect_function_table = wasmTable = wasmExports2["o"];
    }
    var wasmImports = { e: __abort_js, d: __emscripten_runtime_keepalive_clear, a: __setitimer_js, b: _emscripten_resize_heap, c: _proc_exit };
    async function run() {
      preRun();
      if (ABORT) return;
      initRuntime();
      postRun();
    }
    var wasmExports;
    wasmExports = await createWasm();
    await run();
    ;
    return Module;
  }
  var import_meta, syncer_core_single_default;
  var init_syncer_core_single = __esm({
    "../../../syncer.c/bindings/wasm/dist/syncer-core.single.mjs"() {
      import_meta = {};
      syncer_core_single_default = createSyncerModule;
    }
  });

  // ../../../syncer.c/bindings/wasm/lib/wrap.mjs
  function createBinding(moduleFactory) {
    let mod = null;
    let pending = null;
    function initSyncer2(options) {
      if (mod) return Promise.resolve(api);
      if (!pending) {
        const moduleArg = {};
        if (options && options.wasmBinary) moduleArg.wasmBinary = options.wasmBinary;
        if (options && options.locateFile) moduleArg.locateFile = options.locateFile;
        pending = Promise.resolve().then(() => moduleFactory(moduleArg)).then((m) => {
          mod = m;
          return api;
        }).catch((err) => {
          pending = null;
          throw err;
        });
      }
      return pending;
    }
    function isReady2() {
      return mod !== null;
    }
    function allocString(str) {
      const bytes = mod.lengthBytesUTF8(str) + 1;
      const ptr = mod._malloc(bytes);
      if (!ptr) throw new Error("opto-sync wasm: out of memory allocating a string");
      mod.stringToUTF8(str, ptr, bytes);
      return ptr;
    }
    function allocOptionalString(value) {
      return typeof value === "string" ? allocString(value) : 0;
    }
    function mergeJson2(baseJson, incomingJson, options) {
      if (!mod) throw new Error(NOT_READY);
      if (typeof baseJson !== "string" || typeof incomingJson !== "string") {
        throw new TypeError("String expected");
      }
      let overrideCb = null;
      let opts = {};
      if (typeof options === "function") {
        overrideCb = options;
      } else if (options !== null && typeof options === "object") {
        opts = options;
        if (typeof opts.overrideCb === "function") overrideCb = opts.overrideCb;
      }
      const owned = [];
      let cbPtr = 0;
      let callbackError = null;
      let callbackThrew = false;
      const alloc = (v) => {
        const p = allocOptionalString(v);
        if (p) owned.push(p);
        return p;
      };
      try {
        const pBase = allocString(baseJson);
        owned.push(pBase);
        const pIncoming = allocString(incomingJson);
        owned.push(pIncoming);
        const pLww = alloc(opts.lwwKeys);
        const pFww = alloc(opts.fwwKeys);
        const pMatch = alloc(opts.arrayMatchKeys);
        const strategy = typeof opts.arrayStrategy === "number" ? opts.arrayStrategy | 0 : 0;
        const maxDepth = typeof opts.maxDepth === "number" ? opts.maxDepth >>> 0 : 0;
        const detect = opts.detectCircularRefs === true ? 1 : 0;
        const resolve = opts.resolveByTimestamp === true ? 1 : 0;
        let resultPtr;
        if (overrideCb) {
          cbPtr = mod.addFunction((pathPtr, v1Ptr, v2Ptr) => {
            if (callbackThrew) return 0;
            let res;
            try {
              res = overrideCb(
                mod.UTF8ToString(pathPtr),
                mod.UTF8ToString(v1Ptr),
                mod.UTF8ToString(v2Ptr)
              );
            } catch (err) {
              callbackThrew = true;
              callbackError = err;
              return 0;
            }
            if (typeof res !== "string") return 0;
            return allocString(res);
          }, "iiii");
          resultPtr = mod._syncer_merge_flat_cb(
            pBase,
            pIncoming,
            strategy,
            maxDepth,
            detect,
            resolve,
            pLww,
            pFww,
            pMatch,
            cbPtr
          );
        } else {
          resultPtr = mod._syncer_merge_flat(
            pBase,
            pIncoming,
            strategy,
            maxDepth,
            detect,
            resolve,
            pLww,
            pFww,
            pMatch
          );
        }
        if (callbackError) {
          if (resultPtr) mod._syncer_free(resultPtr);
          throw callbackError;
        }
        if (!resultPtr) return null;
        const out = mod.UTF8ToString(resultPtr);
        mod._syncer_free(resultPtr);
        return out;
      } finally {
        for (const p of owned) mod._free(p);
        if (cbPtr) mod.removeFunction(cbPtr);
      }
    }
    function version2() {
      if (!mod) throw new Error(NOT_READY);
      return mod.UTF8ToString(mod._syncer_version());
    }
    function heapAllocatedBytes2() {
      if (!mod) throw new Error(NOT_READY);
      return mod._syncer_wasm_alloc_bytes();
    }
    function heapTotalBytes2() {
      if (!mod) throw new Error(NOT_READY);
      return mod.HEAPU8.length;
    }
    const api = {
      initSyncer: initSyncer2,
      isReady: isReady2,
      mergeJson: mergeJson2,
      version: version2,
      ArrayStrategy: ArrayStrategy2,
      heapAllocatedBytes: heapAllocatedBytes2,
      heapTotalBytes: heapTotalBytes2
    };
    return api;
  }
  var ArrayStrategy2, NOT_READY;
  var init_wrap = __esm({
    "../../../syncer.c/bindings/wasm/lib/wrap.mjs"() {
      ArrayStrategy2 = Object.freeze({
        REPLACE: 0,
        APPEND: 1,
        UNION: 2,
        MERGE_BY_INDEX: 3,
        MERGE_BY_KEY: 4
      });
      NOT_READY = "opto-sync wasm: engine not initialized. Call `await initSyncer()` before mergeJson()/version().";
    }
  });

  // ../../../syncer.c/bindings/wasm/index.mjs
  var wasm_exports = {};
  __export(wasm_exports, {
    ArrayStrategy: () => ArrayStrategy3,
    default: () => wasm_default,
    heapAllocatedBytes: () => heapAllocatedBytes,
    heapTotalBytes: () => heapTotalBytes,
    initSyncer: () => initSyncer,
    isReady: () => isReady,
    mergeJson: () => mergeJson,
    version: () => version
  });
  var binding, initSyncer, isReady, mergeJson, version, ArrayStrategy3, heapAllocatedBytes, heapTotalBytes, wasm_default;
  var init_wasm = __esm({
    "../../../syncer.c/bindings/wasm/index.mjs"() {
      init_syncer_core_single();
      init_wrap();
      binding = createBinding(syncer_core_single_default);
      initSyncer = binding.initSyncer;
      isReady = binding.isReady;
      mergeJson = binding.mergeJson;
      version = binding.version;
      ArrayStrategy3 = binding.ArrayStrategy;
      heapAllocatedBytes = binding.heapAllocatedBytes;
      heapTotalBytes = binding.heapTotalBytes;
      wasm_default = binding;
    }
  });

  // dist/esm/browser.js
  var browser_exports = {};
  __export(browser_exports, {
    ArrayStrategy: () => ArrayStrategy,
    DEFAULT_RECONCILE_OPTIONS: () => DEFAULT_RECONCILE_OPTIONS,
    OptoSyncClient: () => OptoSyncClient,
    OptoSyncDatabase: () => OptoSyncDatabase,
    SYNC_STATUS: () => SYNC_STATUS,
    createOptoSyncClient: () => createOptoSyncClient,
    engineVersion: () => engineVersion,
    getMergeEngine: () => getMergeEngine,
    hasMergeEngine: () => hasMergeEngine,
    initOptoSync: () => initOptoSync,
    isOptoSyncReady: () => isOptoSyncReady,
    mergeEngineKind: () => mergeEngineKind,
    reconcileIncoming: () => reconcileIncoming,
    resetMergeEngine: () => resetMergeEngine,
    resolveReconcileOptions: () => resolveReconcileOptions,
    setMergeEngine: () => setMergeEngine
  });

  // dist/esm/engine.js
  var ArrayStrategy = Object.freeze({
    REPLACE: 0,
    APPEND: 1,
    UNION: 2,
    MERGE_BY_INDEX: 3,
    MERGE_BY_KEY: 4
  });
  var current = null;
  var currentKind = null;
  function setMergeEngine(engine, kind = "custom") {
    if (!engine || typeof engine.mergeJson !== "function" || typeof engine.version !== "function") {
      throw new TypeError("opto-sync: a merge engine must provide mergeJson() and version()");
    }
    current = engine;
    currentKind = kind;
  }
  function hasMergeEngine() {
    return current !== null;
  }
  function mergeEngineKind() {
    return currentKind;
  }
  function getMergeEngine() {
    if (!current) {
      throw new Error('opto-sync: no merge engine installed. In a browser, `await initOptoSync()` (from "@opto-sync/client/browser") before reconciling; in Node, import "@opto-sync/client", which installs the native engine for you.');
    }
    return current;
  }
  function resetMergeEngine() {
    current = null;
    currentKind = null;
  }

  // node_modules/dexie/import-wrapper.mjs
  var import_dexie = __toESM(require_dexie(), 1);
  var DexieSymbol = Symbol.for("Dexie");
  var Dexie = globalThis[DexieSymbol] || (globalThis[DexieSymbol] = import_dexie.default);
  if (import_dexie.default.semVer !== Dexie.semVer) {
    throw new Error(`Two different versions of Dexie loaded in the same app: ${import_dexie.default.semVer} and ${Dexie.semVer}`);
  }
  var {
    liveQuery,
    mergeRanges,
    rangesOverlap,
    RangeSet,
    cmp,
    Entity,
    PropModification,
    replacePrefix,
    add,
    remove,
    DexieYProvider
  } = Dexie;
  var import_wrapper_default = Dexie;

  // dist/esm/reconcile-core.js
  var DEFAULT_RECONCILE_OPTIONS = Object.freeze({
    arrayStrategy: ArrayStrategy.MERGE_BY_KEY,
    arrayMatchKeys: "id",
    resolveByTimestamp: true,
    lwwKeys: "updatedAt,syncedAt",
    fwwKeys: "createdAt"
  });
  function resolveReconcileOptions(options) {
    return { ...DEFAULT_RECONCILE_OPTIONS, ...options };
  }
  function reconcileIncoming(existingLocalPayload, incomingPayload, options) {
    const baseJson = JSON.stringify(existingLocalPayload);
    const incomingJson = JSON.stringify(incomingPayload);
    const mergedJson = getMergeEngine().mergeJson(baseJson, incomingJson, resolveReconcileOptions(options));
    if (mergedJson === null) {
      throw new Error("opto-sync: CRDT merge failed (payload was not valid JSON)");
    }
    return JSON.parse(mergedJson);
  }
  function engineVersion() {
    return getMergeEngine().version();
  }

  // dist/esm/client.js
  var SYNC_STATUS = Object.freeze({
    PENDING: 0,
    SYNCED: 1,
    FAILED: 2
  });
  var OptoSyncDatabase = class extends import_wrapper_default {
    localMutations;
    constructor(name = "OptoSyncDatabase") {
      super(name);
      this.version(1).stores({
        localMutations: "++id, tableName, recordId, syncStatus"
      });
    }
  };
  var OptoSyncClient = class {
    db;
    options;
    constructor(options) {
      const { databaseName, ...reconcileOptions } = options ?? {};
      this.db = new OptoSyncDatabase(databaseName);
      this.options = resolveReconcileOptions(reconcileOptions);
    }
    /**
     * Queue an optimistic local write.
     */
    async queueMutation(tableName, recordId, payload) {
      const id = await this.db.localMutations.add({
        tableName,
        recordId,
        jsonPayload: JSON.stringify(payload),
        createdAt: Date.now(),
        syncStatus: SYNC_STATUS.PENDING
      });
      this.triggerBackgroundSync();
      return id;
    }
    /** All queued mutations still waiting to be pushed to the server. */
    async pendingMutations(tableName) {
      let mutations = await this.db.localMutations.where("syncStatus").equals(SYNC_STATUS.PENDING).toArray();
      if (tableName !== void 0) {
        mutations = mutations.filter((m) => m.tableName === tableName);
      }
      return mutations;
    }
    /** Mark a queued mutation as synced (or failed). */
    async markMutation(id, syncStatus) {
      await this.db.localMutations.update(id, { syncStatus });
    }
    /**
     * Process an incoming payload from the server against the local copy.
     * Pure: no storage is touched — the caller persists the returned merge.
     *
     * Synchronous, on every platform. In a browser this requires that
     * `await initOptoSync()` (or the createOptoSyncClient() factory) has already
     * run; it throws a descriptive error otherwise rather than reconciling with
     * no engine.
     */
    reconcileIncoming(_tableName, _recordId, incomingPayload, existingLocalPayload, overrides) {
      return reconcileIncoming(existingLocalPayload, incomingPayload, {
        ...this.options,
        ...overrides
      });
    }
    triggerBackgroundSync() {
    }
  };

  // dist/esm/browser.js
  var initPromise = null;
  function initOptoSync(options) {
    if (!initPromise) {
      initPromise = (async () => {
        const wasm = await Promise.resolve().then(() => (init_wasm(), wasm_exports));
        await wasm.initSyncer(options);
        setMergeEngine({
          mergeJson: (base, incoming, opts) => wasm.mergeJson(base, incoming, opts),
          version: () => wasm.version()
        }, "wasm");
      })().catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  }
  function isOptoSyncReady() {
    return hasMergeEngine();
  }
  async function createOptoSyncClient(options) {
    const { init, ...clientOptions } = options ?? {};
    await initOptoSync(init);
    return new OptoSyncClient(clientOptions);
  }
  return __toCommonJS(browser_exports);
})();
