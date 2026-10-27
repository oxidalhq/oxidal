#define _POSIX_C_SOURCE 200809L
// Bounded Lilv/LV2 ownership boundary. Plugins are trusted native code, not sandboxed.
#include <lilv/lilv.h>
#include <lv2/atom/atom.h>
#include <lv2/buf-size/buf-size.h>
#include <lv2/options/options.h>
#include <lv2/parameters/parameters.h>
#include <lv2/urid/urid.h>
#include <lv2/worker/worker.h>
#include <stdatomic.h>
#include <stddef.h>
#include <time.h>
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define MAX_PORTS 128
#define MAX_URIS 256
static _Thread_local char error[512];
static int fail(const char* message) { snprintf(error, sizeof(error), "%s", message); return -1; }
const char* ox_lv2_error(void) { return error; }
void* ox_lv2_world(const char* bundle) {
    LilvWorld* w = lilv_world_new();
    if (!w) { fail("Lilv world allocation failed"); return NULL; }
    if (bundle) {
        LilvNode* uri = lilv_new_file_uri(w, NULL, bundle);
        if (!uri) { lilv_world_free(w); fail("Invalid bundle path"); return NULL; }
        lilv_world_load_bundle(w, uri); lilv_node_free(uri);
    } else { lilv_world_load_all(w); }
    return w;
}
void ox_lv2_world_free(void* world) { lilv_world_free(world); }
uint32_t ox_lv2_count(void* world) { return lilv_plugins_size(lilv_world_get_all_plugins(world)); }
const LilvPlugin* ox_lv2_plugin(void* world, uint32_t index) {
    const LilvPlugins* plugins = lilv_world_get_all_plugins(world);
    uint32_t n = 0;
    LILV_FOREACH(plugins, i, plugins) { if (n++ == index) return lilv_plugins_get(plugins, i); }
    return NULL;
}
const char* ox_lv2_uri(const LilvPlugin* p) { return lilv_node_as_uri(lilv_plugin_get_uri(p)); }
// Lilv returns an owned name node. Copy before releasing it; Rust copies this
// thread-local result before any subsequent metadata call.
const char* ox_lv2_name(const LilvPlugin* p) {
    static _Thread_local char name[4097];
    LilvNode* n = lilv_plugin_get_name(p);
    const char* text = n ? lilv_node_as_string(n) : NULL;
    if (!text || !*text || strlen(text) >= sizeof(name)) {
        lilv_node_free(n); return NULL;
    }
    memcpy(name, text, strlen(text) + 1);
    lilv_node_free(n); return name;
}
uint32_t ox_lv2_ports(const LilvPlugin* p) { return lilv_plugin_get_num_ports(p); }
const char* ox_lv2_symbol(const LilvPlugin* p, uint32_t index) {
    const LilvPort* port = lilv_plugin_get_port_by_index(p, index);
    return port ? lilv_node_as_string(lilv_port_get_symbol(p, port)) : NULL;
}
static int is_class(LilvWorld* w, const LilvPlugin* p, const LilvPort* port, const char* uri) {
    LilvNode* node = lilv_new_uri(w, uri);
    int result = lilv_port_is_a(p, port, node); lilv_node_free(node); return result;
}
static int property(LilvWorld* w, const LilvPlugin* p, const LilvPort* port, const char* uri) {
    LilvNode* node = lilv_new_uri(w, uri);
    int result = lilv_port_has_property(p, port, node); lilv_node_free(node); return result;
}
// flags: audio, control, input, output, integer, toggled, sampleRate, logarithmic, latency.
int ox_lv2_port(void* world, const LilvPlugin* p, uint32_t index, float* def, float* min, float* max) {
    LilvWorld* w = world; const LilvPort* port = lilv_plugin_get_port_by_index(p, index);
    if (!port) return fail("Missing port");
    int flags = is_class(w,p,port,LV2_CORE__AudioPort) | (is_class(w,p,port,LV2_CORE__ControlPort)<<1)
      | (is_class(w,p,port,LV2_CORE__InputPort)<<2) | (is_class(w,p,port,LV2_CORE__OutputPort)<<3)
      | (property(w,p,port,LV2_CORE__integer)<<4) | (property(w,p,port,LV2_CORE__toggled)<<5)
      | (property(w,p,port,LV2_CORE__sampleRate)<<6)
      | (property(w,p,port,"http://lv2plug.in/ns/ext/port-props#logarithmic")<<7)
      | (property(w,p,port,LV2_CORE__reportsLatency)<<8);
    LilvNode* designation=lilv_new_uri(w,LV2_CORE__designation);
    LilvNode* value=lilv_port_get(p,port,designation);
    LilvNode* latency=lilv_new_uri(w,LV2_CORE__latency);
    if (value && lilv_node_equals(value,latency)) flags|=256;
    lilv_node_free(designation);lilv_node_free(value);lilv_node_free(latency);
    LilvNode *d=NULL,*lo=NULL,*hi=NULL; lilv_port_get_range(p,port,&d,&lo,&hi);
    *def=d?lilv_node_as_float(d):NAN; *min=lo?lilv_node_as_float(lo):NAN; *max=hi?lilv_node_as_float(hi):NAN;
    lilv_node_free(d);lilv_node_free(lo);lilv_node_free(hi);
    return flags;
}
static int features_ok(LilvWorld* w, const LilvPlugin* p) {
    LilvNodes* required=lilv_plugin_get_required_features(p);
    int ok=1;
    LILV_FOREACH(nodes,i,required) {
        const char* uri=lilv_node_as_uri(lilv_nodes_get(required,i));
        if (!uri || (strcmp(uri,LV2_URID__map) && strcmp(uri,LV2_URID__unmap)
            && strcmp(uri,LV2_WORKER__schedule) && strcmp(uri,LV2_OPTIONS__options) && strcmp(uri,LV2_BUF_SIZE__boundedBlockLength)
            && strcmp(uri,LV2_BUF_SIZE__fixedBlockLength) && strcmp(uri,LV2_BUF_SIZE__powerOf2BlockLength))) {
            fail(uri?uri:"Invalid required feature"); ok=0;break;
        }
    }
    lilv_nodes_free(required);
    LilvNode* key=lilv_new_uri(w,LV2_OPTIONS__requiredOption);
    required=lilv_plugin_get_value(p,key);lilv_node_free(key);
    LILV_FOREACH(nodes,i,required) {
        const char* uri=lilv_node_as_uri(lilv_nodes_get(required,i));
        if (!uri || (strcmp(uri,LV2_BUF_SIZE__minBlockLength) && strcmp(uri,LV2_BUF_SIZE__maxBlockLength)
            && strcmp(uri,LV2_BUF_SIZE__nominalBlockLength) && strcmp(uri,LV2_PARAMETERS__sampleRate))) {
            fail(uri?uri:"Invalid required option");ok=0;break;
        }
    }
    lilv_nodes_free(required);return ok;
}
int ox_lv2_supported(void* w,const LilvPlugin* p) { return features_ok(w,p)?0:-1; }
// SPSC queues: audio owner produces requests and consumes responses; the
// background worker does the inverse. No allocation, lock or wake syscall in
// schedule_work/respond. Publication uses release/acquire, never volatile.
#define WORK_SLOTS 16
#define WORK_BYTES 4096
typedef struct {uint32_t size; _Alignas(max_align_t) unsigned char data[WORK_BYTES];} WorkMessage;
typedef struct {atomic_uint read, write; WorkMessage slots[WORK_SLOTS];} WorkQueue;
typedef struct {
    WorkQueue requests, responses;
    atomic_uint stopping, failed, finished;
    pthread_t thread;
    int started;
    LilvInstance* instance;
    const LV2_Worker_Interface* interface;
    LV2_Worker_Schedule schedule;
} Worker;
static LV2_Worker_Status enqueue(WorkQueue* q,uint32_t size,const void* data) {
    if (size>WORK_BYTES) return LV2_WORKER_ERR_NO_SPACE;
    if (size && !data) return LV2_WORKER_ERR_UNKNOWN;
    unsigned w=atomic_load_explicit(&q->write,memory_order_relaxed);
    unsigned r=atomic_load_explicit(&q->read,memory_order_acquire);
    if (w-r>=WORK_SLOTS) return LV2_WORKER_ERR_NO_SPACE;
    WorkMessage* m=&q->slots[w%WORK_SLOTS];m->size=size;
    if (size) memcpy(m->data,data,size);
    atomic_store_explicit(&q->write,w+1,memory_order_release);
    return LV2_WORKER_SUCCESS;
}
static LV2_Worker_Status schedule_work(void* handle,uint32_t size,const void* data) {
    Worker* w=handle;
    if (atomic_load_explicit(&w->stopping,memory_order_acquire)) return LV2_WORKER_ERR_UNKNOWN;
    return enqueue(&w->requests,size,data);
}
static LV2_Worker_Status respond_work(void* handle,uint32_t size,const void* data) {
    return enqueue(&((Worker*)handle)->responses,size,data);
}
static void worker_responses(Worker* w) {
    unsigned r=atomic_load_explicit(&w->responses.read,memory_order_relaxed);
    // Snapshot bounds this cycle even when work_response schedules more work.
    unsigned end=atomic_load_explicit(&w->responses.write,memory_order_acquire);
    while (r!=end) {
        WorkMessage* m=&w->responses.slots[r%WORK_SLOTS];
        if (w->interface->work_response(lilv_instance_get_handle(w->instance),m->size,m->size?m->data:NULL)!=LV2_WORKER_SUCCESS)
            atomic_store_explicit(&w->failed,1,memory_order_release);
        atomic_store_explicit(&w->responses.read,++r,memory_order_release);
    }
}
static void* worker_main(void* raw) {
    Worker* w=raw;
    for (;;) {
        unsigned r=atomic_load_explicit(&w->requests.read,memory_order_relaxed);
        unsigned end=atomic_load_explicit(&w->requests.write,memory_order_acquire);
        if (r==end) {
            if (atomic_load_explicit(&w->stopping,memory_order_acquire)) break;
            const struct timespec pause={0,1000000};nanosleep(&pause,NULL);continue;
        }
        WorkMessage* m=&w->requests.slots[r%WORK_SLOTS];
        if (w->interface->work(lilv_instance_get_handle(w->instance),respond_work,w,m->size,m->size?m->data:NULL)!=LV2_WORKER_SUCCESS)
            atomic_store_explicit(&w->failed,1,memory_order_release);
        atomic_store_explicit(&w->requests.read,r+1,memory_order_release);
    }
    atomic_store_explicit(&w->finished,1,memory_order_release);
    return NULL;
}
static Worker* worker_new(void) {
    Worker* w=calloc(1,sizeof(Worker));if (!w) return NULL;
    atomic_init(&w->requests.read,0);atomic_init(&w->requests.write,0);
    atomic_init(&w->responses.read,0);atomic_init(&w->responses.write,0);
    atomic_init(&w->stopping,0);atomic_init(&w->failed,0);atomic_init(&w->finished,0);
    if (!atomic_is_lock_free(&w->requests.read)) {free(w);return NULL;}
    w->schedule=(LV2_Worker_Schedule){w,schedule_work};return w;
}
static void worker_stop(Worker* w) {
    if (!w) return;
    atomic_store_explicit(&w->stopping,1,memory_order_release);
    // Shutdown is non-real-time. Drain all accepted work before freeing the
    // instance, then deliver every accepted response on the original owner.
    if (w->started) {
        while (!atomic_load_explicit(&w->finished,memory_order_acquire)) {
            worker_responses(w);
            const struct timespec pause={0,1000000};nanosleep(&pause,NULL);
        }
        pthread_join(w->thread,NULL);worker_responses(w);
    }
}
static int wants_worker(LilvWorld* world,const LilvPlugin* p) {
    LilvNode* schedule=lilv_new_uri(world,LV2_WORKER__schedule);
    LilvNode* interface=lilv_new_uri(world,LV2_WORKER__interface);
    int result=lilv_plugin_has_feature(p,schedule)||lilv_plugin_has_extension_data(p,interface);
    lilv_node_free(schedule);lilv_node_free(interface);return result;
}
typedef struct {
    LilvInstance* instance;
    int active;
    uint32_t frames, ports, count, ins, outs;
    uint32_t input[2], output[2];
    float control[MAX_PORTS];
    float* audio[MAX_PORTS];
    pthread_mutex_t urid_lock;
    char uris[MAX_URIS][256];
    LV2_URID_Map map;
    LV2_URID_Unmap unmap;
    int32_t block_size;
    float sample_rate;
    LV2_Options_Option options[5];
    Worker* worker;
    LV2_Feature features[7];
    const LV2_Feature* feature_ptrs[8];
} Host;
static LV2_URID map_uri(void* handle,const char* uri) {
    Host* h=handle;if (!uri || strlen(uri)>=256) return 0;
    pthread_mutex_lock(&h->urid_lock);
    uint32_t result=0;
    for (uint32_t i=0;i<h->count;i++) if (!strcmp(h->uris[i],uri)) {result=i+1;break;}
    if (!result && h->count<MAX_URIS) {strcpy(h->uris[h->count++],uri);result=h->count;}
    pthread_mutex_unlock(&h->urid_lock);return result;
}
static const char* unmap_uri(void* handle,LV2_URID id) {
    Host* h=handle;pthread_mutex_lock(&h->urid_lock);
    const char* result=(id && id<=h->count)?h->uris[id-1]:NULL;
    pthread_mutex_unlock(&h->urid_lock);return result;
}
void ox_lv2_free(void* raw) {
    Host* h=raw;if (!h) return;
    worker_stop(h->worker);
    if (h->instance) {if (h->active) lilv_instance_deactivate(h->instance);lilv_instance_free(h->instance);}
    for (uint32_t i=0;i<h->ports;i++) free(h->audio[i]);
    pthread_mutex_destroy(&h->urid_lock);free(h->worker);free(h);
}
void* ox_lv2_new(void* world,const LilvPlugin* p,double rate,uint32_t frames) {
    if (!isfinite(rate)||rate<8000||rate>192000||!frames||frames>2048||(frames&(frames-1))) {fail("Require power-of-two block size 1–2048 and rate 8000–192000");return NULL;}
    if (!features_ok(world,p)) return NULL;
    uint32_t ports=lilv_plugin_get_num_ports(p);
    if (!ports||ports>MAX_PORTS) {fail("Port count outside 1–128");return NULL;}
    Host* h=calloc(1,sizeof(Host));if (!h) {fail("Host allocation failed");return NULL;}
    if (pthread_mutex_init(&h->urid_lock,NULL)) {free(h);fail("URID mutex failed");return NULL;}
    h->frames=frames;h->ports=ports;h->block_size=(int32_t)frames;h->sample_rate=(float)rate;
    h->map=(LV2_URID_Map){h,map_uri};h->unmap=(LV2_URID_Unmap){h,unmap_uri};
    const char* keys[]={LV2_BUF_SIZE__minBlockLength,LV2_BUF_SIZE__maxBlockLength,LV2_BUF_SIZE__nominalBlockLength,LV2_PARAMETERS__sampleRate};
    for (int i=0;i<4;i++) h->options[i]=(LV2_Options_Option){LV2_OPTIONS_INSTANCE,0,map_uri(h,keys[i]),sizeof(int32_t),map_uri(h,i==3?LV2_ATOM__Float:LV2_ATOM__Int),i==3?(void*)&h->sample_rate:(void*)&h->block_size};
    h->features[0]=(LV2_Feature){LV2_URID__map,&h->map};h->features[1]=(LV2_Feature){LV2_URID__unmap,&h->unmap};
    h->features[2]=(LV2_Feature){LV2_OPTIONS__options,h->options};
    h->features[3]=(LV2_Feature){LV2_BUF_SIZE__boundedBlockLength,NULL};
    h->features[4]=(LV2_Feature){LV2_BUF_SIZE__fixedBlockLength,NULL};
    h->features[5]=(LV2_Feature){LV2_BUF_SIZE__powerOf2BlockLength,NULL};
    for (int i=0;i<6;i++) h->feature_ptrs[i]=&h->features[i];
    if (wants_worker(world,p)) {
        h->worker=worker_new();
        if (!h->worker) {fail("Worker queue allocation/lock-free atomics unavailable");goto failed;}
        h->features[6]=(LV2_Feature){LV2_WORKER__schedule,&h->worker->schedule};
        h->feature_ptrs[6]=&h->features[6];
    }
    uint32_t latency_ports=0;
    for (uint32_t i=0;i<ports;i++) {
        float d,lo,hi;int flags=ox_lv2_port(world,p,i,&d,&lo,&hi);
        if ((flags&3)!=1 && (flags&3)!=2) {fail("Unsupported port class (only audio/control)");goto failed;}
        if ((flags&12)!=4 && (flags&12)!=8) {fail("Ambiguous port direction");goto failed;}
        if ((flags&256) && ((flags&15)!=10 || ++latency_ports>1)) {fail("Latency needs one output control port");goto failed;}
        if (flags&1) {
            h->audio[i]=calloc(frames,sizeof(float));if (!h->audio[i]) {fail("Audio buffer allocation failed");goto failed;}
            if (flags&4) {if (h->ins>=2) {fail("Too many input channels");goto failed;}h->input[h->ins++]=i;}
            else {if (h->outs>=2) {fail("Too many output channels");goto failed;}h->output[h->outs++]=i;}
        } else if (flags&256) {
            // Never mistake an unwritten output for zero latency.
            h->control[i]=NAN;
        } else if (flags&4) {
            if (flags&64) {d*=rate;lo*=rate;hi*=rate;}
            if (!isfinite(d)||!isfinite(lo)||!isfinite(hi)||lo>=hi||d<lo||d>hi) {fail("Input control needs finite bounded range/default");goto failed;}
            h->control[i]=d;
        }
    }
    if (h->ins!=h->outs || (h->ins!=1 && h->ins!=2)) {fail("Require mono/mono or stereo/stereo audio ports");goto failed;}
    h->instance=lilv_plugin_instantiate(p,rate,h->feature_ptrs);
    if (!h->instance) {fail("Plugin instantiate rejected supplied features");goto failed;}
    for (uint32_t i=0;i<ports;i++) lilv_instance_connect_port(h->instance,i,h->audio[i]?h->audio[i]:&h->control[i]);
    if (h->worker) {
        Worker* w=h->worker;w->instance=h->instance;
        w->interface=lilv_instance_get_extension_data(h->instance,LV2_WORKER__interface);
        if (!w->interface || !w->interface->work || !w->interface->work_response) {fail("Missing LV2 worker callbacks");goto failed;}
        if (pthread_create(&w->thread,NULL,worker_main,w)) {fail("Worker thread creation failed");goto failed;}
        w->started=1;
    }
    lilv_instance_activate(h->instance);h->active=1;return h;
failed: ox_lv2_free(h);return NULL;
}
// Core LV2 run(0) updates instant control outputs without consuming audio.
// Called only during latency preparation or a control transaction, never discovery.
static void run_cycle(Host* h,uint32_t frames) {
    lilv_instance_run(h->instance,frames);
    if (h->worker) {
        worker_responses(h->worker);
        if (h->worker->interface->end_run && h->worker->interface->end_run(lilv_instance_get_handle(h->instance))!=LV2_WORKER_SUCCESS)
            atomic_store_explicit(&h->worker->failed,1,memory_order_release);
    }
}
int ox_lv2_refresh_outputs(void* raw) {
    Host* h=raw;run_cycle(h,0);
    return h->worker && atomic_load_explicit(&h->worker->failed,memory_order_acquire)?fail("LV2 worker callback failed"):0;
}
// Rust validates port kind/range; every call is serialized on the instance owner.
void ox_lv2_set(void* raw,uint32_t port,float value) {Host* h=raw;h->control[port]=value;}
float ox_lv2_get(void* raw,uint32_t port) {Host* h=raw;return h->control[port];}
int ox_lv2_run(void* raw,float* left,float* right,uint32_t frames) {
    Host* h=raw;if (frames!=h->frames) return fail("Block length differs from instantiate options");
    memcpy(h->audio[h->input[0]],left,frames*sizeof(float));
    if (h->ins==2) memcpy(h->audio[h->input[1]],right,frames*sizeof(float));
    run_cycle(h,frames);
    if (h->worker && atomic_load_explicit(&h->worker->failed,memory_order_acquire)) return fail("LV2 worker callback failed");
    for (uint32_t n=0;n<frames;n++) {
        left[n]=h->audio[h->output[0]][n];
        if (h->outs==2) right[n]=h->audio[h->output[1]][n];
        if (!isfinite(left[n]) || (h->outs==2 && !isfinite(right[n]))) return fail("Nonfinite plugin output");
    }
    return 0;
}
