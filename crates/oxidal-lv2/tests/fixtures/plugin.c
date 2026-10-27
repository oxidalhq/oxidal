#define _POSIX_C_SOURCE 200809L
// Authored ABI/processing fixture, not a musical effect or a model of a third-party plugin.
#include <lv2/core/lv2.h>
#include <lv2/urid/urid.h>
#include <lv2/options/options.h>
#include <lv2/buf-size/buf-size.h>
#include <lv2/atom/atom.h>
#include <lv2/atom/util.h>
#include <lv2/midi/midi.h>
#include <stdlib.h>
#include <assert.h>
#include <lv2/worker/worker.h>
#include <lv2/state/state.h>
#include <lv2/units/units.h>
#include <stdio.h>
#include <pthread.h>
#include <stdatomic.h>
#include <time.h>
#include <math.h>
#include <string.h>
typedef struct {float* p[6];float history[2][2048];uint32_t frames;} Test;
static LV2_Handle create(const LV2_Descriptor* d,double rate,const char* path,const LV2_Feature*const* features) {
    (void)d;(void)rate;(void)path;
    LV2_URID_Map* map=NULL;LV2_URID_Unmap* unmap=NULL;const LV2_Options_Option* opts=NULL;int fixed=0,bounded=0,power=0;
    for (int i=0;features && features[i];i++) {
        if (!strcmp(features[i]->URI,LV2_URID__map)) map=features[i]->data;
        if (!strcmp(features[i]->URI,LV2_URID__unmap)) unmap=features[i]->data;
        if (!strcmp(features[i]->URI,LV2_OPTIONS__options)) opts=features[i]->data;
        fixed|=!strcmp(features[i]->URI,LV2_BUF_SIZE__fixedBlockLength);
        bounded|=!strcmp(features[i]->URI,LV2_BUF_SIZE__boundedBlockLength);
        power|=!strcmp(features[i]->URI,LV2_BUF_SIZE__powerOf2BlockLength);
    }
    if (!map||!unmap||!opts||!fixed||!bounded||!power) return NULL;
    uint32_t sizes[3]={0};const char* keys[]={LV2_BUF_SIZE__minBlockLength,LV2_BUF_SIZE__maxBlockLength,LV2_BUF_SIZE__nominalBlockLength};
    for (int i=0;i<3;i++) for (const LV2_Options_Option* o=opts;o->key;o++) if (o->key==map->map(map->handle,keys[i])) {
        if (o->type!=map->map(map->handle,LV2_ATOM__Int)||o->size!=sizeof(int32_t)||o->context!=LV2_OPTIONS_INSTANCE) return NULL;
        sizes[i]=*(const uint32_t*)o->value;
    }
    if (!sizes[0]||sizes[0]>2048||sizes[0]!=sizes[1]||sizes[0]!=sizes[2]||(sizes[0]&(sizes[0]-1))) return NULL;
    LV2_URID id=map->map(map->handle,"urn:oxidal:test:roundtrip");
    if (!id||strcmp(unmap->unmap(unmap->handle,id),"urn:oxidal:test:roundtrip")) return NULL;
    Test* t=calloc(1,sizeof(Test));if(t)t->frames=sizes[0];return t;
}
static void connect(LV2_Handle h,uint32_t p,void* data){if(p<6)((Test*)h)->p[p]=data;}
static void run(LV2_Handle h,uint32_t n){Test* t=h;if(n!=t->frames)abort();for(uint32_t c=0;c<2;c++)for(uint32_t i=0;i<n;i++){float v=t->p[c][i]*(*t->p[4])+t->history[c][i]*(*t->p[5]);t->history[c][i]=v;t->p[2+c][i]=v;}}
static void cleanup(LV2_Handle h){free(h);}
static const LV2_Descriptor descriptor={"urn:oxidal:test:contract",create,connect,NULL,run,NULL,cleanup,NULL};
static const LV2_Descriptor quantized={"urn:oxidal:test:quantized",create,connect,NULL,run,NULL,cleanup,NULL};
// Deliberately reports only from run(), including the core run(0) query.
// Mode selects malformed or spontaneously changing latency for host rejection tests.
typedef struct {float* p[7];float history[2][1024];uint32_t position;int stuck, stereo;} Latent;
static LV2_Handle latent_create(const LV2_Descriptor* d,double rate,const char* path,const LV2_Feature*const* features) {
    (void)rate;(void)path;(void)features;Latent* t=calloc(1,sizeof(Latent));if(t)t->stereo=!strcmp(d->URI,"urn:oxidal:test:latency-stereo");return t;
}
static void latent_connect(LV2_Handle h,uint32_t p,void* data){if(p<7)((Latent*)h)->p[p]=data;}
static void latent_run(LV2_Handle h,uint32_t n) {
    Latent* t=h;uint32_t channels=t->stereo?2:1, offset=t->stereo?2:0;float delay=*t->p[3+offset];int mode=(int)*t->p[4+offset];
    if(mode==6)t->stuck=1;
    *t->p[2+offset]=t->stuck?NAN:mode==1?-1.0f:mode==2?NAN:mode==3?delay+0.5f:mode==4?4294967296.0f:delay;
    if(n && mode==5) *t->p[2+offset]=delay+1.0f;
    uint32_t frames=(uint32_t)delay;
    for(uint32_t i=0;i<n;i++) {
        for(uint32_t c=0;c<channels;c++) {
            t->history[c][t->position]=t->p[c][i];
            t->p[c+channels][i]=t->history[c][(t->position+1024-frames)%1024];
        }
        t->position=(t->position+1)%1024;
    }
}
static const LV2_Descriptor latency={"urn:oxidal:test:latency",latent_create,latent_connect,NULL,latent_run,NULL,cleanup,NULL};
static const LV2_Descriptor latency_legacy={"urn:oxidal:test:latency-legacy",latent_create,latent_connect,NULL,latent_run,NULL,cleanup,NULL};
static const LV2_Descriptor latency_stereo={"urn:oxidal:test:latency-stereo",latent_create,latent_connect,NULL,latent_run,NULL,cleanup,NULL};
// Deliberately stalls only the background work to prove scheduling is bounded,
// copied and delivered on the owner, including teardown with outstanding work.
typedef struct {
    float* p[8];const LV2_Worker_Schedule* schedule;pthread_t owner;
    atomic_uint release, worked, responded, completed;
    uint32_t accepted, received, ends;int dispatched,restoring;float gain;
} Async;
static LV2_Handle async_create(const LV2_Descriptor* d,double rate,const char* path,const LV2_Feature*const* features) {
    (void)d;(void)rate;(void)path;
    Async* a=calloc(1,sizeof(Async));if(!a)return NULL;
    a->owner=pthread_self();a->gain=1;
    atomic_init(&a->release,0);atomic_init(&a->worked,0);atomic_init(&a->responded,0);atomic_init(&a->completed,0);
    for(int i=0;features && features[i];i++)if(!strcmp(features[i]->URI,LV2_WORKER__schedule))a->schedule=features[i]->data;
    if(!a->schedule){free(a);return NULL;}return a;
}
static void async_connect(LV2_Handle h,uint32_t p,void* data){if(p<8)((Async*)h)->p[p]=data;}
static void async_run(LV2_Handle h,uint32_t n) {
    Async* a=h;assert(pthread_equal(a->owner,pthread_self()));
    *a->p[7]=0;
    if(*a->p[2]>=2)atomic_store(&a->release,1);
    if(*a->p[2]>0 && !a->dispatched) {
        a->dispatched=1;uint32_t count=*a->p[2]==1?64:1;
        for(uint32_t i=1;i<=count;i++) {
            uint32_t message[2]={a->accepted+1,(uint32_t)*a->p[2]};
            LV2_Worker_Status status=a->schedule->schedule_work(a->schedule->handle,sizeof(message),message);
            if(status==LV2_WORKER_SUCCESS)a->accepted++;else {assert(status==LV2_WORKER_ERR_NO_SPACE);(*a->p[4])++;}
            message[0]=999; // Host must have copied stack bytes before returning.
        }
        char oversized[4097]={0};
        assert(a->schedule->schedule_work(a->schedule->handle,sizeof(oversized),oversized)==LV2_WORKER_ERR_NO_SPACE);
        *a->p[3]=(float)a->accepted;
    }
    if(*a->p[2]==5 && !a->received) {
        // This fixture deliberately blocks its own run only to saturate the
        // response queue deterministically; production plugin RT safety is separate.
        const struct timespec pause={0,1000000};unsigned attempts=0;
        while(!atomic_load(&a->completed) && attempts++<3000)nanosleep(&pause,NULL);
        assert(atomic_load(&a->completed));assert(a->received==0);
    }
    for(uint32_t i=0;i<n;i++)a->p[1][i]=a->p[0][i]*a->gain;
}
static LV2_Worker_Status async_work(LV2_Handle h,LV2_Worker_Respond_Function respond,LV2_Worker_Respond_Handle handle,uint32_t size,const void* data) {
    Async* a=h;assert(!!pthread_equal(a->owner,pthread_self())==a->restoring);assert(size==2*sizeof(uint32_t));
    const uint32_t* message=data;assert(message[0]==atomic_load(&a->worked)+1);
    const struct timespec pause={0,1000000};while(!atomic_load(&a->release))nanosleep(&pause,NULL);
    if(message[1]==3 || message[1]==5) {const struct timespec delay={0,20000000};nanosleep(&delay,NULL);}
    atomic_fetch_add(&a->worked,1);
    if(message[1]==4)return LV2_WORKER_ERR_UNKNOWN;
    uint32_t count=message[1]==5?64:1;
    for(uint32_t i=0;i<count;i++) {
        uint32_t response=message[1]==5?i+1:message[0];
        LV2_Worker_Status status=respond(handle,sizeof(response),&response);
        if(status==LV2_WORKER_SUCCESS)atomic_fetch_add(&a->responded,1);
        else {assert(status==LV2_WORKER_ERR_NO_SPACE);break;}
        response=999;
    }
    atomic_store(&a->completed,1);return LV2_WORKER_SUCCESS;
}
static LV2_Worker_Status async_response(LV2_Handle h,uint32_t size,const void* data) {
    Async* a=h;assert(pthread_equal(a->owner,pthread_self()));assert(size==sizeof(uint32_t));
    assert(*(const uint32_t*)data==a->received+1);a->received++;a->gain=(float)a->received;
    *a->p[5]=(float)a->received;return LV2_WORKER_SUCCESS;
}
static LV2_Worker_Status async_end(LV2_Handle h) {
    Async* a=h;assert(pthread_equal(a->owner,pthread_self()));*a->p[6]=(float)++a->ends;return LV2_WORKER_SUCCESS;
}
static const LV2_Worker_Interface async_interface={async_work,async_response,async_end};
static LV2_State_Status async_save(LV2_Handle h,LV2_State_Store_Function store,LV2_State_Handle context,uint32_t flags,const LV2_Feature*const* features) {
    (void)flags;Async* a=h;LV2_URID_Map* map=NULL;
    for(unsigned i=0;features && features[i];i++)if(!strcmp(features[i]->URI,LV2_URID__map))map=features[i]->data;
    assert(map);return store(context,map->map(map->handle,"urn:oxidal:test:async-gain"),&a->gain,sizeof(float),map->map(map->handle,LV2_ATOM__Float),3);
}
static LV2_State_Status async_restore(LV2_Handle h,LV2_State_Retrieve_Function retrieve,LV2_State_Handle context,uint32_t flags,const LV2_Feature*const* features) {
    (void)flags;Async* a=h;LV2_URID_Map* map=NULL;LV2_Worker_Schedule* schedule=NULL;
    for(unsigned i=0;features && features[i];i++) {
        if(!strcmp(features[i]->URI,LV2_URID__map))map=features[i]->data;
        if(!strcmp(features[i]->URI,LV2_WORKER__schedule))schedule=features[i]->data;
    }
    assert(map && schedule && schedule!=a->schedule);
    size_t size=0;uint32_t type=0,stored_flags=0;
    const void* value=retrieve(context,map->map(map->handle,"urn:oxidal:test:async-gain"),&size,&type,&stored_flags);
    if(!value || size!=sizeof(float) || type!=map->map(map->handle,LV2_ATOM__Float))return LV2_STATE_ERR_BAD_TYPE;
    float gain;memcpy(&gain,value,sizeof(float));
    a->restoring=1;atomic_store(&a->release,1);uint32_t message[2]={++a->accepted,2};
    assert(schedule->schedule_work(schedule->handle,sizeof(message),message)==LV2_WORKER_SUCCESS);
    assert(a->received==a->accepted);a->restoring=0;a->gain=gain;return LV2_STATE_SUCCESS;
}
static const LV2_State_Interface async_state={async_save,async_restore};
static const void* async_extension(const char* uri){return !strcmp(uri,LV2_WORKER__interface)?(const void*)&async_interface:!strcmp(uri,LV2_STATE__interface)?(const void*)&async_state:NULL;}

static void async_cleanup(LV2_Handle h) {
    Async* a=h;assert(pthread_equal(a->owner,pthread_self()));
    assert(a->accepted==atomic_load(&a->worked));assert(a->received==atomic_load(&a->responded));free(a);
}
static const LV2_Descriptor async_descriptor={"urn:oxidal:test:worker",async_create,async_connect,NULL,async_run,NULL,async_cleanup,async_extension};
static const LV2_Descriptor missing_worker={"urn:oxidal:test:missing-worker",async_create,async_connect,NULL,async_run,NULL,async_cleanup,NULL};
typedef struct {float* in;float* out;float* mode;float* latency;LV2_Atom_Sequence* input;LV2_Atom_Sequence* output;LV2_URID frame_unit,sequence,floating,midi,path_type,urid,string_type,gain_key,path_key,token_key,name_key,token;LV2_URID_Map* map;float gain;char path[4096];} Atoms;
static LV2_Handle atoms_create(const LV2_Descriptor* d,double rate,const char* path,const LV2_Feature*const* features) {
    (void)d;(void)rate;(void)path;LV2_URID_Map* map=NULL;
    for(int i=0;features && features[i];i++)if(!strcmp(features[i]->URI,LV2_URID__map))map=features[i]->data;
    if(!map)return NULL;
    Atoms* a=calloc(1,sizeof(Atoms));if(!a)return NULL;
    a->gain=1;a->sequence=map->map(map->handle,LV2_ATOM__Sequence);a->floating=map->map(map->handle,LV2_ATOM__Float);a->midi=map->map(map->handle,LV2_MIDI__MidiEvent);
    a->frame_unit=map->map(map->handle,LV2_UNITS__frame);a->map=map;a->path_type=map->map(map->handle,LV2_ATOM__Path);a->urid=map->map(map->handle,LV2_ATOM__URID);a->string_type=map->map(map->handle,LV2_ATOM__String);
    a->gain_key=map->map(map->handle,"urn:oxidal:test:gain");a->path_key=map->map(map->handle,"urn:oxidal:test:file");a->token_key=map->map(map->handle,"urn:oxidal:test:token");a->name_key=map->map(map->handle,"urn:oxidal:test:name");
    a->token=map->map(map->handle,"urn:oxidal:test:profile");return a;
}
static void atoms_connect(LV2_Handle h,uint32_t port,void* data) {
    Atoms* a=h;switch(port){case 0:a->in=data;break;case 1:a->out=data;break;case 2:a->input=data;break;case 3:a->output=data;break;case 4:a->mode=data;break;case 5:a->latency=data;break;}
}
static void atoms_run(LV2_Handle h,uint32_t n) {
    Atoms* a=h;*a->latency=0;assert(a->input->atom.type==a->sequence);assert(a->input->body.unit==0 && a->input->body.pad==0);
    assert(a->output->atom.size+sizeof(LV2_Atom)>=a->input->atom.size+sizeof(LV2_Atom));
    memcpy(a->output,a->input,a->input->atom.size+sizeof(LV2_Atom));a->output->body.unit=a->frame_unit;
    LV2_Atom_Event* event=lv2_atom_sequence_begin(&a->input->body);
    for(uint32_t frame=0;frame<n;frame++) {
        while(!lv2_atom_sequence_is_end(&a->input->body,a->input->atom.size,event) && event->time.frames==frame) {
            if(event->body.type==a->floating && event->body.size==sizeof(float))memcpy(&a->gain,event+1,sizeof(float));
            if(event->body.type==a->midi && event->body.size==3) {const unsigned char* midi=(const unsigned char*)(event+1);if(midi[0]==0xB0 && midi[1]==7)a->gain=midi[2]/127.0f;}
            if(event->body.type==a->urid && event->body.size==sizeof(a->token))memcpy(&a->token,event+1,sizeof(a->token));
            if(event->body.type==a->path_type && event->body.size>0 && event->body.size<sizeof(a->path)) {
                const char* path=(const char*)(event+1);assert(path[event->body.size-1]==0);memcpy(a->path,path,event->body.size);
            }
            event=lv2_atom_sequence_next(event);
        }
        a->out[frame]=a->in[frame]*a->gain;
    }
    if(n && *a->mode>0 && *a->mode<7) {
        LV2_Atom_Event* e=(LV2_Atom_Event*)((unsigned char*)a->output+sizeof(LV2_Atom_Sequence));
        a->output->atom.size=sizeof(LV2_Atom_Sequence_Body)+sizeof(LV2_Atom_Event);
        *e=(LV2_Atom_Event){.time.frames=0,.body={0,a->floating}};
        switch((int)*a->mode) {
            case 1:a->output->atom.size=UINT32_MAX;break;
            case 2:e->body.size=UINT32_MAX;break;
            case 3:e->time.frames=n;break;
            case 4:a->output->body.unit=UINT32_MAX;break;
            case 5:e->body.type=0;break;
            case 6:a->output->atom.size--;break;
        }
    }
}
static LV2_State_Status atoms_save(LV2_Handle h,LV2_State_Store_Function store,LV2_State_Handle context,uint32_t flags,const LV2_Feature*const* features) {
    (void)flags;Atoms* a=h;LV2_State_Map_Path* map=NULL;LV2_State_Free_Path* release=NULL;
    for(unsigned i=0;features && features[i];i++) {
        if(!strcmp(features[i]->URI,LV2_STATE__mapPath))map=features[i]->data;
        if(!strcmp(features[i]->URI,LV2_STATE__freePath))release=features[i]->data;
    }
    uint32_t property_flags=*a->mode==8?LV2_STATE_IS_POD:LV2_STATE_IS_POD|LV2_STATE_IS_PORTABLE;
    // Deliberately ignores store failure; the host must still reject the snapshot.
    store(context,a->gain_key,&a->gain,sizeof(float),a->floating,property_flags);
    store(context,a->token_key,&a->token,sizeof(a->token),a->urid,3);
    store(context,a->name_key,"Fixture",8,a->string_type,3);
    if(a->path[0]) {
        if(!map || !release)return LV2_STATE_ERR_NO_FEATURE;
        char* path=map->abstract_path(map->handle,a->path);if(!path)return LV2_STATE_ERR_UNKNOWN;
        store(context,a->path_key,path,strlen(path)+1,a->path_type,3);release->free_path(release->handle,path);
    }
    return LV2_STATE_SUCCESS;
}
static LV2_State_Status atoms_restore(LV2_Handle h,LV2_State_Retrieve_Function retrieve,LV2_State_Handle context,uint32_t flags,const LV2_Feature*const* features) {
    (void)flags;Atoms* a=h;
    if(*a->mode==7) {a->gain=999;return LV2_STATE_ERR_UNKNOWN;}
    size_t size=0;uint32_t type=0,property_flags=0;
    const void* value=retrieve(context,a->gain_key,&size,&type,&property_flags);
    if(!value || size!=sizeof(float) || type!=a->floating)return LV2_STATE_ERR_BAD_TYPE;
    memcpy(&a->gain,value,sizeof(float));
    value=retrieve(context,a->token_key,&size,&type,&property_flags);
    if(!value || size!=sizeof(a->token) || type!=a->urid)return LV2_STATE_ERR_BAD_TYPE;
    memcpy(&a->token,value,sizeof(a->token));
    const char* name=retrieve(context,a->name_key,NULL,NULL,NULL);if(name)assert(!strcmp(name,"Fixture"));
    value=retrieve(context,a->path_key,&size,&type,&property_flags);
    if(value) {
        LV2_State_Map_Path* map=NULL;LV2_State_Free_Path* release=NULL;
        for(unsigned i=0;features && features[i];i++) {
            if(!strcmp(features[i]->URI,LV2_STATE__mapPath))map=features[i]->data;
            if(!strcmp(features[i]->URI,LV2_STATE__freePath))release=features[i]->data;
        }
        if(!map || !release || type!=a->path_type)return LV2_STATE_ERR_NO_FEATURE;
        char* absolute=map->absolute_path(map->handle,value);if(!absolute)return LV2_STATE_ERR_UNKNOWN;
        if(strlen(absolute)>=sizeof(a->path)){release->free_path(release->handle,absolute);return LV2_STATE_ERR_NO_SPACE;}
        strcpy(a->path,absolute);release->free_path(release->handle,absolute);
        FILE* file=fopen(a->path,"rb");if(!file)return LV2_STATE_ERR_UNKNOWN;
        size_t read=fread(&a->gain,sizeof(float),1,file);fclose(file);if(read!=1)return LV2_STATE_ERR_UNKNOWN;
    } else a->path[0]=0;
    return LV2_STATE_SUCCESS;
}
static const LV2_State_Interface atoms_state={atoms_save,atoms_restore};
static const void* atoms_extension(const char* uri){return !strcmp(uri,LV2_STATE__interface)?&atoms_state:NULL;}
static const LV2_Descriptor atoms_descriptor={"urn:oxidal:test:atoms",atoms_create,atoms_connect,NULL,atoms_run,NULL,cleanup,atoms_extension};
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index){return index==0?&descriptor:index==1?&quantized:index==2?&latency:index==3?&latency_legacy:index==4?&latency_stereo:index==5?&async_descriptor:index==6?&missing_worker:index==7?&atoms_descriptor:NULL;}
