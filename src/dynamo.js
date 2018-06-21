// --------------------------------------------------------------------
// DynaMo - interactive, (Dyna)mic 3D (Mo)dels for the web using x3dom
// ulrich.krispel@fraunhofer.at

/**--------------------------------------------------------------------
 * Internal quaternion class (for rotation accumulation) a+b*i+c*j+d*k
 * @constructor
 */
var Quaternion = function(a, b, c, d) {
  this.a = a ? a : 0.0;
  this.b = b ? b : 0.0;
  this.c = c ? c : 0.0;
  this.d = d ? d : 1.0;
}
/** Initialize quaternion with axis angle representation. */
Quaternion.prototype.setAxisAngle = function(x, y, z, angle) {
  var sina = Math.sin(angle/2.0);
  this.a = Math.cos(angle/2.0);
  var n = 1.0/Math.sqrt(x*x+y*y+z*z);
  this.b = x * sina * n;  this.c = y * sina * n;  this.d = z * sina * n;
  this.normalize();
}
/** Normalize quaternion to norm one ||q|| = 1 */
Quaternion.prototype.normalize = function() {
  var n = 1.0/Math.sqrt(this.a*this.a+this.b*this.b+this.c*this.c+this.d*this.d);
  this.a *= n;  this.b *= n;  this.c *= n;  this.d *= n;
}
/** Construct a new q from the combination of this q with another q */
Quaternion.prototype.combine = function(q) {
  return new Quaternion(
      this.a*q.a - this.b*q.b - this.c*q.c - this.d*q.d,
      this.a*q.b + this.b*q.a + this.c*q.d - this.d*q.c,
      this.a*q.c - this.b*q.d + this.c*q.a + this.d*q.b,
      this.a*q.d + this.b*q.c - this.c*q.b + this.d*q.a
  );
}

/** Get Axis-angle representation of the current quaterion in the format [x,y,z,angle] */
Quaternion.prototype.getAxisAngle = function() 
{
  if (this.d > 1.0) this.normalize();
  var angle,x,y,z;
  angle = 2 * Math.acos(this.d);
  var s = Math.sqrt(1.0-this.d*this.d);
  if (s < 0.001) { x=this.a;  y=this.b;  z=this.c; } 
  else { x=this.a/s;  y=this.b/s;  z=this.c/s; }
  return [x,y,z,angle];
}

/** returns a string representation "Q[a,b,c,d]" */
Quaternion.prototype.toString = function()
{
  return "Q["+this.a+","+this.b+","+this.c+","+this.d+"]";
}
// ----------------------------------------------------------------------------


/**--------------------------------------------------------------------
 * The DynaMo Instance Object
 * @constructor
 */
var DynaMoInstance = function(x3dId, spec, stateChangedHandler) {
  this._DEBUG = false;

  // bind to x3d canvas
  this.X3D_ELEMENT = document.getElementById(x3dId);
  if (!this.X3D_ELEMENT) { alert("error: could not find x3d canvas:" + x3dId +", DynaMo will not work." ); }
  this.X3D_NAMESPACE = "__";          // for mapDEFToID of inline nodes

  // set global state
  this.spec = spec;
  this.activeAnimations = {};
  //
  if (stateChangedHandler) {
    this.stateChangedHandler = stateChangedHandler;
  } else {
    this.stateChangedHandler = function() {}
  }
  
  var self=this;

  // get list of modified fields
  STATE_MODIFIERS = {};
  var statenames = Object.keys(this.spec.states);
  for (var i=0, ie=statenames.length; i<ie; ++i) {
    var st = this.spec.states[statenames[i]].state;
    for (var j=0, je=st.length; j<je; ++j) {
      if (st[j]["field"]) { STATE_MODIFIERS[st[j]["field"]] = true; }
    }
  }
  
  // BUILD GROUPS
  if ("groups" in this.spec) {
    for (group in this.spec.groups) {
      console.log('### parsing group ' + group);
      var grp = this.spec.groups[group];
      grp["x3dnode"] = [];
      
      // node matching heuristic:
      // match id or DEF, or given attribute name
      var matchNode = function(cnode, expr, options) {
        if (!options) { options={}; }
        if (self._DEBUG) { console.log("trying to match node id:" + cnode.id + " with expr " + expr); }
        if (cnode instanceof Object) {
          // match node id
          if (typeof(cnode.id)=="string") {
            //console.log("matching node id " + cnode.id);
            if (cnode.id.match(expr) != null) {
              return true;
            }
          }
          // match DEF or attribute
          if (typeof cnode.getAttribute === "function") {
            var attname="DEF";
            if ('attribute' in options) { attname=options["attribute"]; }
            var attvalue = cnode.getAttribute(attname);
            if (self._DEBUG) { console.log("matching attribute " + attname + " : " + attvalue); }
            if (typeof(attvalue)=="string") {
              if(attname=="DEF") {
                if(typeof(cnode.id)=="string" ) {
                  if ((cnode.id.length > 0) && (self.X3D_NAMESPACE+attvalue) != cnode.id) {
                    alert('scene problem, id mapping mismatch: cnode.id:' + cnode.id + ' attribute:' + self.X3D_NAMESPACE+attvalue);
                  }
                }
              }
              return attvalue.match(expr) != null;
            }
          }
          return null;  // drop node
        }
      };
      
      // if a node matched, remember its initial state and add it to the group
      var addNodeToGroup = function(cnode) {
          if (self._DEBUG) { console.log("adding node " + cnode); }
          if (!("savestate" in cnode)) { cnode["savestate"] = {} }
          // prepare initial node state
          for (modifier in STATE_MODIFIERS) {
            initial_value = cnode.getAttribute(modifier);
            if (self._DEBUG) { console.log("initial value:" + initial_value + " of modifier:" + modifier); }
            // hacky: need to ignore specific "invalid" values so they don't
            // break the initial value
            if(modifier=='rotation') {
              if (initial_value=="0,0,0,0") {  initial_value = undefined;  }
            }
            // parse initial value
            if (initial_value) {
              if (initial_value == 'true' || initial_value=='false') {
                cnode["savestate"][modifier] = initial_value == 'true';
              } else {
                cnode["savestate"][modifier] = initial_value.split(" ").map(function(e){ return Number(e); });
                if(cnode["savestate"][modifier].length==1) {
                  cnode["savestate"][modifier] = initial_value.split(",").map(function(e){ return Number(e); });
                }
              }
              if (self._DEBUG) {  
                console.log('initial ' + cnode.id + ' [ ' + modifier + ' ] => ' 
                  + JSON.stringify(cnode["savestate"][modifier])); 
              }
            }
          }
          // add the node to the group
          grp["x3dnode"].push(cnode);
      };
      
      // first matching heuristic: "parent" matches only children of a
      // given parent node
      if (self._DEBUG) { console.log("## group " + grp + " state modifiers:" + Object.keys(STATE_MODIFIERS).toString()); }
      if ('parent' in grp) {
        var parent = document.getElementById(this.X3D_NAMESPACE+grp.parent);
        for ( child in parent.childNodes ) {
          var expr = new RegExp(grp.match);
          var cnode = parent.childNodes[child];
          var match = matchNode(cnode, expr);
          if (match != null) {
            if (grp.modifier == "NOT") {  match = !match; }
            if(match) { addNodeToGroup(cnode); }
          }
        }
      } else {
        // second matching heuristic: "root" traverses the subtree of
        // a given root node (or the scene root if none is specified)
        var rootnode;
        if ('root' in grp) {
          // start with given root node
          rootnode = document.getElementById(this.X3D_NAMESPACE+grp.root);
        } else {
          // start with x3d scene node
          for (var c in this.X3D_ELEMENT.children) {
            if (this.X3D_ELEMENT.children[c].nodeName=="SCENE") {
              rootnode = this.X3D_ELEMENT.children[c];
              break;
            }
          }
        }
        if (!rootnode) { alert("could not find root scene node"); }

        if (!this.spec.groups[group].match) { alert("error: no patten match for group " + group); }
        var matchExpr = new RegExp(this.spec.groups[group].match);
 
        // recursive subtree traversal
        var traverse = function(node, depth) {
          // scan tree for matches, do not search in subtrees of matched nodes
          var match = matchNode(node, matchExpr);
          if (match == null) match=false;
          if (grp.modifier == "NOT") {  match = !match; }
          if(match) { 
           if (self._DEBUG) { console.log("**** Node match: " + node.id); }
            addNodeToGroup(node); 
          } else {
            if (node.childNodes) {
              for (var cid=0,cide=node.childNodes.length; cid<cide; ++cid) {
                traverse(node.childNodes[cid], D+1);
              }
            }
          }
        };
        var D=0;
        traverse(rootnode,D);
      }
      console.log('found ' + grp["x3dnode"].length + ' nodes.');
    }
  }

  if (self._DEBUG) { console.log('initializing state data'); }
  // initialize state data

  var stateNames = Object.keys(this.spec.states);
  for (var i=0,ie=stateNames.length; i<ie; ++i) {
    var changes = this.getStateChangeList(stateNames[i])
    this.spec.states[stateNames[i]].statedata = this.accumulateChanges(changes);
  }

  // print some statistics after initialization
  console.log('DynaMo initalized, states:' + Object.keys(spec.states).length);

  var animations = this.activeAnimations;
  var dynamo = this;
 
  // the animation frame red 
  var redrawHandler = function() {

    var remove=[];
    for (var i in animations) {
      //
      var anim=animations[i];
      if (anim) {
        //console.log('apply animation ' + JSON.stringify(anim));
        var seq = anim.currentSeq();
        dynamo.applyStateTransition(seq.from, seq.to, anim.t);

        anim.tick();
        // remove finished oneshot animations
        if(anim.cycles>0) { 
          if(anim.cycle=="false") {
            console.log('remove animation ' + i);
            remove.push(i); 
          }
        }
      }
    }
    for (var j=0,je=remove.length; j<je; ++j) {
      animations[j]=undefined;
    }
   
    window.requestAnimationFrame(redrawHandler);
  }

  // start frame handler
  this.redrawHandler = redrawHandler;
  window.requestAnimationFrame(redrawHandler);
}

/**--------------------------------------------------------------------
 * An animation consists of a sequence of state transitions
 * @constructor
 */
var DynaMoAnimation = function(data) {
 
  // inherit data properties (defaults)
  for (key in data) { this[key] = data[key]; }
 
  // initialize animation state
  this.reset();
  this.cycles=0;
};

/** Reset the animation to the start of the sequence */
DynaMoAnimation.prototype.reset = function() {
  this.startTime = performance.now();
  this.t = 0;
  this.seqIndex = 0;
}

/** Returns the current transition in the sequence */
DynaMoAnimation.prototype.currentSeq = function() {
  return this.sequence[this.seqIndex];
}

/** tick() advances the animation w.r.t. to the current time */
DynaMoAnimation.prototype.tick = function () {
  //
  var curTime = performance.now();
  this.t = (curTime-this.startTime)/(this.sequence[this.seqIndex].dur*1000.0);
  //console.log("anim.tick(): t:" + this.t + " startTime: " + this.startTime + " curTime: " + curTime);
  //
  if (this.t >= 1.0) {
    // advance to next transition
    this.t=0;
    this.startTime = performance.now();
    if(++this.seqIndex >= this.sequence.length) {
      this.seqIndex=0;
      this.cycles++;
    }
  }
}

// -------------------------------------------- change accumulation

// TODO: special handling of hierarchical operations:
// - apply translation in local coordinate system (propagate throgh world transform)
//   translation value
//   x3dom getCurrentTransform

/** gather changes for affected nodes of a state value association */
DynaMoInstance.prototype.gatherChanges = function(changeList, kf) {
  // change only a single element
  if ("id" in kf) {
    if("field" in kf) {
      this.addChange(changeList, kf.id, kf.field, kf.value);
    }
  }
  // gather changes for all affected nodes of a group
  if ("group" in kf) {
    if (!(kf["group"] in this.spec.groups)) {  alert("error: group " + kf["group"] + " not found!"); }
    var x3dnod=this.spec.groups[kf["group"]].x3dnode;
    for(var i=0, ie=x3dnod.length; i<ie; ++i) {
      var node=x3dnod[i];
      if("field" in kf) {
        this.addChange(changeList, node.id, kf.field, kf.value);
      }
    }
  }
}


/** add an incremental change of one node property to the changelist */
DynaMoInstance.prototype.addChange = function(changeList, id, field, value) {
  //console.log('addChange ' + id + ' : ' + field + ' -> ' + value);
  if (!(id in changeList)) { changeList[id]={} };
  if (!(field in changeList[id])) { changeList[id][field]=[]; }
  // if (field=="translation") {
  //   // apply translations in global coordinate system
  //   var matrix=this.X3D_ELEMENT.runtime.getCurrentTransform(document.getElementById(id)).inverse();
  //   var v = new x3dom.fields.SFVec3f(value[0],value[1],value[2]);
  //   var vlocal = matrix.multMatrixPnt(v);
  //   value=[vlocal[0],vlocal[1],vlocal[2]];
  // }
  changeList[id][field].push(value);
}


/** accumulate all incremental changes for all node properties of a changeList */
DynaMoInstance.prototype.accumulateChanges = function (changeList) {
  accumulatedChanges = {};
  //console.log('changelist' + JSON.stringify(changeList));
  for (var id in changeList) {
    accumulatedChanges[id] = {}
    var changes = changeList[id];
    var node=document.getElementById(id);
    // accumulate changes
    for (var field in changes) {
      var initial;
      var chvalues;
      if(node.savestate) { initial=node["savestate"][field]; }
      if (initial) {  chvalues = [initial].concat(changes[field]);  } 
      else {  chvalues = changes[field];  }
      //console.log('change values:' + JSON.stringify(chvalues) + ' initial:' + initial);
      var value;
      if (chvalues.length == 1) {
        value = chvalues[0];
      } else {
        switch(field) {
          case 'translation': case 'center':
            value=[0,0,0];
            for(var i=0,ie=chvalues.length; i<ie; ++i) {
              cv = chvalues[i];
              value[0]+=cv[0]; value[1]+=cv[1]; value[2]+=cv[2];
            }
          break;
          case 'rotation':
            // accumulate rotations
            var rot = new Quaternion();
            for(var i=0,ie=chvalues.length; i<ie; ++i) {
              q = new Quaternion();
              aa = chvalues[i];
              q.setAxisAngle(aa[0],aa[1],aa[2],aa[3]);
              rot = rot.combine(q);
            }
            value = rot.getAxisAngle();
          break;
          case 'meanvalue':
            // mean
            var s=0;
            for(var i=0,ie=chvalues.length; i<ie; ++i) {
              s+=chvalues[i];
            }
            value = s / chvalues.length;
          break;
          case 'render':
            // boolean: use logical and
            var value=true;
            for(var i=0,ie=chvalues.length; i<ie; ++i) {
              value=value && chvalues[i];
            }
          break;
          default:
            alert('warning, field ' + field + ' accumulation not handled!');
            break;
        }
      }
      if (this._DEBUG) { console.log(id + ":" + field + ":" + JSON.stringify(chvalues) + " => " + JSON.stringify(value)); }
      accumulatedChanges[id][field] = value;
    }
  }
  return accumulatedChanges;
}


/** apply all accumulated changes to node properties */
DynaMoInstance.prototype.applyAccumulatedChanges = function(aChanges) {
  for (id in aChanges) {
    var node=document.getElementById(id);
    for (field in aChanges[id]) {
      node.setAttribute(field, aChanges[id][field]);
    }
  }
}


/** get change list for a specific state */
DynaMoInstance.prototype.getStateChangeList = function(name) {
  var changeList = {};
  var slide = this.spec.states[ name ];
  for (var i=0, ie=slide["state"].length; i<ie; ++i) {
    this.gatherChanges(changeList, slide["state"][i]);
  }
  return changeList;  
}


//----------------------------------------------------- apply state changes

/** apply all accumulated changes for state */
DynaMoInstance.prototype.applyState = function(state) {
  // state.statedata is precalculated
  this.applyAccumulatedChanges(state.statedata);
}

// ---------------------------------------------- state transition
/** apply inbetweening between states at time t0=[0..1] */
DynaMoInstance.prototype.applyStateTransition = function(from, to, t0)
{
  var fromState = this.spec.states[from].statedata;
  var toState = this.spec.states[to].statedata;
    // 1d barycentric
    // t0 = [0..1]
    var t1 = 1.0 - t0;
    //
    for (id in toState) {
      var node=document.getElementById(id);
      for (field in toState[id]) {
        var fromValue=null, toValue=null;
        if (fromState[id]) { fromValue = fromState[id][field]; }
        if (toState[id])   { toValue = toState[id][field]; }
        var value;
        if ((typeof(fromValue)==typeof(toValue)) && (fromValue!=undefined) && (fromValue!=null)) {
          if (fromValue instanceof Array) {
            // # Array #
            value = new Array(toValue.length);
            // linear interpolation
            for (var i=0,ie=toValue.length; i<ie; ++i) {
              value[i] = fromValue[i]*t1 + toValue[i]*t0;
            }
          } else if (typeof(fromValue)=="number") {
            // # Number #
            value = fromValue*t1 + toValue*t0;
          } else if (typeof(fromValue)=="boolean") {
            // # Boolean #
            value = t0 < 0.5 ? fromValue : toValue;
          } else {
            if (this._DEBUG) {
              alert("PROBLEM==> id: " + id + " field " + field + " from state " + from  + ":" + fromValue + " [" + typeof(fromValue) + "] to " + to + ":" + toValue + " [" + typeof(toValue) + "]");
            }
          }
        } else if (fromValue==undefined) {
          value = toValue;
        } else if (toValue==undefined) {
          value = fromValue;
        } else {
            alert("PROBLEM==> id: " + id + " field " + field + " from state " + from  + ":" + fromValue + " [" + typeof(fromValue) + "] to " + to + ":" + toValue + " [" + typeof(toValue) + "]");
        }
        node.setAttribute(field, value);
      }
    }
};


// -------------------------------------------- public interface

/** set the state changed handler */
DynaMoInstance.prototype.setStateChangedHandler = function(handler) {
   this.stateChangedHandler = handler;
}

/** apply all accumulated changes for state */
DynaMoInstance.prototype.setState = function(id) {
      this.applyState(this.spec.states[ id ]);
      this.stateChangedHandler(this);
}

/** immediately perform a transition from -> to */
DynaMoInstance.prototype.doStateTransition = function(from, to, duration, finishCB) {
  //
  var dynamo = this;  
  var startTime = performance.now();
  var timeDuration = duration*1000.0;
  //
  var transitionHandler = function() {
    //
    var curTime=performance.now();
    var t = (curTime-startTime)/timeDuration;
    if (t>1.0) t=1.0;
    dynamo.applyStateTransition(from, to, t );
    //
    if (t < 1.0) {
      window.requestAnimationFrame(transitionHandler);
    } else {
      if (finishCB) { finishCB(); }
    }
  };
  window.requestAnimationFrame(transitionHandler);
};

/** enable animation sequence anID -> to */
DynaMoInstance.prototype.enableAnimation = function(anID) {
  //
  if (anID in this.spec.animations) {
    console.log("enable animation: " + anID);
    var anim=new DynaMoAnimation(this.spec.animations[anID]);
    this.activeAnimations[anID] = anim;
  }
}

/** disable animation sequence anID */
DynaMoInstance.prototype.disableAnimation = function(anID) {
  if (anID in this.activeAnimations) {
    console.log("disable animation: " + anID);
    this.activeAnimations[anID] = undefined;
  }
}
