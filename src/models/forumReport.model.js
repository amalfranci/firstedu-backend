import mongoose from "mongoose";

const forumReportSchema = new mongoose.Schema({

    forumId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Forum",
        required:true
    },

    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:true
    },

    reason:{
        type:String,
        required:true
    }

},{
    timestamps:true
});

export default mongoose.model(
    "ForumReport",
    forumReportSchema
);